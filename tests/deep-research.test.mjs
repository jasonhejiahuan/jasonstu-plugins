import test from "node:test";
import assert from "node:assert/strict";
import { runDeepResearch } from "../mcp/deep-research.mjs";
import { MetasoError } from "../mcp/metaso-client.mjs";

test("standard deep research plans, searches, reads, and synthesizes", async () => {
  let answerCalls = 0;
  const client = {
    answer: async ({ question }) => {
      answerCalls += 1;
      if (question.includes("Return ONLY a JSON array")) {
        return {
          answer: '[{"query":"alpha evidence","scope":"webpage"}]',
          credits: 6,
        };
      }
      return { answer: "# Result\n\nGrounded claim [S1].", credits: 6 };
    },
    search: async ({ q: query }) => ({
      credits: 3,
      webpages: [
        {
          title: `Source for ${query}`,
          link: "https://example.com/source",
          summary: "Relevant evidence",
          score: "high",
        },
      ],
    }),
    readUrl: async () => ({ title: "Source", markdown: "# Source\nFull evidence", credits: 3 }),
  };
  const result = await runDeepResearch(client, {
    question: "What is alpha?",
    language: "en",
    depth: "standard",
    max_iterations: 2,
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 1,
  });
  assert.match(result.report, /Grounded claim \[S1\]/);
  assert.match(result.report, /https:\/\/example\.com\/source/);
  assert.equal(result.sources.length, 1);
  assert.equal(result.diagnostics.roundsCompleted, 2);
  assert.equal(result.diagnostics.readerCount, 1);
  assert.equal(result.diagnostics.creditsObserved, 27);
  assert.equal(answerCalls, 3);
});

test("deep profile requires explicit high-cost authorization", async () => {
  await assert.rejects(
    runDeepResearch({}, { question: "test", depth: "deep" }),
    (error) => error instanceof MetasoError && error.code === "HIGH_COST_CONFIRMATION_REQUIRED",
  );
});

test("expensive standard configuration also requires authorization", async () => {
  await assert.rejects(
    runDeepResearch(
      {},
      {
        question: "test",
        depth: "standard",
        max_iterations: 2,
        queries_per_round: 6,
        max_sources: 60,
        max_reads: 10,
      },
    ),
    (error) =>
      error instanceof MetasoError &&
      error.code === "HIGH_COST_CONFIRMATION_REQUIRED" &&
      error.details.estimatedCallUpperBound > 18,
  );
});

test("invalid citation IDs trigger one repair pass", async () => {
  let repairCalls = 0;
  const client = {
    answer: async ({ question }) => {
      if (question.includes("Return ONLY a JSON array")) {
        return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
      }
      if (question.includes("Repair the citation markers")) {
        repairCalls += 1;
        return { answer: "# Repaired\n\nSupported claim [S1].", credits: 6 };
      }
      return { answer: "# Draft\n\nUnsupported citation [S99].", credits: 6 };
    },
    search: async () => ({
      credits: 3,
      webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
    }),
    readUrl: async () => assert.fail("Reader should not run"),
  };
  const result = await runDeepResearch(client, {
    question: "test",
    language: "en",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.equal(repairCalls, 1);
  assert.equal(result.diagnostics.citationValidation.valid, true);
  assert.equal(result.diagnostics.citationValidation.repairAttempted, true);
  assert.match(result.report, /Supported claim \[S1\]/);
  assert.doesNotMatch(result.report, /S99/);
});

test("planner JSON survives surrounding reasoning and automatic citations map to source IDs", async () => {
  const searchQueries = [];
  const answerPrompts = [];
  const client = {
    answer: async ({ question }) => {
      answerPrompts.push(question);
      if (question.includes("Return ONLY a JSON array")) {
        return {
          answer:
            '>analysis with an unrelated [1] marker\n\n[{"query":"english evidence","scope":"webpage"}]',
          credits: 6,
        };
      }
      return {
        answer: "English finding [[1]].",
        sources: [{ title: "Source", link: "https://example.com/source" }],
        credits: 6,
      };
    },
    search: async ({ q: query }) => {
      searchQueries.push(query);
      return {
        credits: 3,
        webpages: [
          { title: "Source", link: "https://example.com/source", summary: "Evidence" },
        ],
      };
    },
    readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
  };

  const result = await runDeepResearch(client, {
    question: "test",
    language: "en",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.deepEqual(searchQueries, ["english evidence"]);
  assert.match(result.report, /English finding \[S1\]\./);
  assert.equal(result.diagnostics.citationValidation.valid, true);
  assert.equal(result.diagnostics.citationValidation.repairAttempted, false);
  assert.match(answerPrompts.at(-1), /MANDATORY OUTPUT LANGUAGE: English/);
});

test("answer retrieval sources never exceed max_sources", async () => {
  const client = {
    answer: async ({ question }) => {
      if (question.includes("Return ONLY a JSON array")) {
        return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
      }
      return {
        answer: Array.from({ length: 10 }, (_, index) => `Claim [[${index + 1}]].`).join(" "),
        sources: Array.from({ length: 10 }, (_, index) => ({
          title: `Extra ${index}`,
          link: `https://example.com/extra-${index}`,
        })),
        credits: 6,
      };
    },
    search: async () => ({
      credits: 3,
      webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
    }),
    readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
  };

  const result = await runDeepResearch(client, {
    question: "test",
    language: "en",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.equal(result.sources.length, 5);
  assert.equal(result.diagnostics.sourceCount, 5);
  assert.equal(result.diagnostics.citationValidation.valid, false);
  assert.ok(result.diagnostics.citationValidation.unmappedNativeCitations.length > 0);
});

test("English fallback queries do not silently switch to Chinese", async () => {
  let searchQuery;
  const client = {
    answer: async ({ question }) =>
      question.includes("Return ONLY a JSON array")
        ? { answer: "planner did not return JSON", credits: 6 }
        : { answer: "Supported [S1].", credits: 6 },
    search: async ({ q: query }) => {
      searchQuery = query;
      return {
        credits: 3,
        webpages: [
          { title: "Source", link: "https://example.com/source", summary: "Evidence" },
        ],
      };
    },
    readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
  };

  await runDeepResearch(client, {
    question: "test",
    language: "en",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.match(searchQuery, /key facts and latest developments/);
  assert.doesNotMatch(searchQuery, /关键事实/);
});

test("unmapped native citations prevent a false-positive citation validation", async () => {
  let repairCalls = 0;
  const client = {
    answer: async ({ question }) => {
      if (question.includes("Return ONLY a JSON array")) {
        return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
      }
      if (question.includes("Repair the citation markers")) {
        repairCalls += 1;
        return { answer: "Repaired claim [S1].", credits: 6 };
      }
      return { answer: "One valid claim [S1], but one unmapped claim [[99]].", sources: [] };
    },
    search: async () => ({
      credits: 3,
      webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
    }),
    readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
  };

  const result = await runDeepResearch(client, {
    question: "test",
    language: "en",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.equal(repairCalls, 1);
  assert.equal(result.diagnostics.citationValidation.valid, true);
  assert.equal(result.diagnostics.citationValidation.repairAttempted, true);
});

test("predominantly Chinese output is repaired when English was requested", async () => {
  let repairCalls = 0;
  const client = {
    answer: async ({ question }) => {
      if (question.includes("Return ONLY a JSON array")) {
        return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
      }
      if (question.includes("Repair the citation markers")) {
        repairCalls += 1;
        return { answer: "The requested English report is now corrected [S1].", credits: 6 };
      }
      return {
        answer: "这是一份完全使用中文生成的研究报告，包含足够多的汉字来触发确定性的语言检查 [S1]。",
        credits: 6,
      };
    },
    search: async () => ({
      credits: 3,
      webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
    }),
    readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
  };

  const result = await runDeepResearch(client, {
    question: "test",
    language: "en",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.equal(repairCalls, 1);
  assert.match(result.report, /requested English report/);
  assert.equal(result.diagnostics.languageValidation.valid, true);
  assert.equal(result.diagnostics.languageValidation.repairAttempted, true);
  assert.equal(result.diagnostics.citationValidation.repairAttempted, false);
});

test("fallback query suffixes follow English, Chinese, Japanese, Korean, and neutral locales", async () => {
  const cases = [
    {
      language: "en",
      expectedSuffix: "key facts and latest developments",
      report: "A supported English report [S1].",
    },
    {
      language: "zh-CN",
      expectedSuffix: "关键事实与最新进展",
      report: "这是一份有依据的中文报告 [S1]。",
    },
    {
      language: "ja",
      expectedSuffix: "主要な事実と最新動向",
      report: "これは根拠のある日本語の報告です [S1]。",
    },
    {
      language: "ko",
      expectedSuffix: "핵심 사실과 최신 동향",
      report: "이것은 근거가 있는 한국어 보고서입니다 [S1].",
    },
    {
      language: "fr",
      expectedSuffix: "key facts / latest developments",
      report: "Voici un rapport étayé en français [S1].",
    },
  ];

  for (const fixture of cases) {
    let searchQuery;
    const client = {
      answer: async ({ question }) =>
        question.includes("Return ONLY a JSON array")
          ? { answer: "not valid planner JSON", credits: 6 }
          : { answer: fixture.report, credits: 6 },
      search: async ({ q: query }) => {
        searchQuery = query;
        return {
          credits: 3,
          webpages: [
            { title: "Source", link: "https://example.com/source", summary: "Evidence" },
          ],
        };
      },
      readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
    };

    const result = await runDeepResearch(client, {
      question: "test",
      language: fixture.language,
      depth: "quick",
      queries_per_round: 1,
      max_sources: 5,
      max_reads: 0,
    });
    assert.match(searchQuery, new RegExp(fixture.expectedSuffix.replaceAll("/", "\\/")));
    assert.doesNotMatch(searchQuery, fixture.language === "zh-CN" ? /$^/ : /关键事实/);
    assert.equal(result.diagnostics.languageValidation.valid, true);
    assert.equal(result.diagnostics.languageValidation.repairAttempted, false);
  }
});

test("English script validation repairs short Han, Kana, and Hangul-only reports", async () => {
  for (const wrongReport of ["中文 [S1]。", "かなだけです [S1]。", "한국어로만 작성됨 [S1]."]) {
    let repairCalls = 0;
    const client = {
      answer: async ({ question }) => {
        if (question.includes("Return ONLY a JSON array")) {
          return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
        }
        if (question.includes("Repair the citation markers")) {
          repairCalls += 1;
          return { answer: "The corrected report is in English [S1].", credits: 6 };
        }
        return { answer: wrongReport, credits: 6 };
      },
      search: async () => ({
        credits: 3,
        webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
      }),
      readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
    };

    const result = await runDeepResearch(client, {
      question: "test",
      language: "en",
      depth: "quick",
      queries_per_round: 1,
      max_sources: 5,
      max_reads: 0,
    });
    assert.equal(repairCalls, 1);
    assert.match(result.report, /corrected report is in English/);
    assert.equal(result.diagnostics.languageValidation.checked, true);
    assert.equal(result.diagnostics.languageValidation.valid, true);
    assert.equal(result.diagnostics.languageValidation.repairAttempted, true);
  }
});

test("Chinese, Japanese, and Korean script validation repairs English-only reports", async () => {
  const cases = [
    { language: "zh", repaired: "修复后的中文报告有可靠依据 [S1]。" },
    { language: "ja", repaired: "修正した日本語の報告には根拠があります [S1]。" },
    { language: "ko", repaired: "수정된 한국어 보고서에는 근거가 있습니다 [S1]." },
  ];

  for (const fixture of cases) {
    let repairCalls = 0;
    const client = {
      answer: async ({ question }) => {
        if (question.includes("Return ONLY a JSON array")) {
          return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
        }
        if (question.includes("Repair the citation markers")) {
          repairCalls += 1;
          return { answer: fixture.repaired, credits: 6 };
        }
        return { answer: "This report is entirely in English [S1].", credits: 6 };
      },
      search: async () => ({
        credits: 3,
        webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
      }),
      readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
    };

    const result = await runDeepResearch(client, {
      question: "test",
      language: fixture.language,
      depth: "quick",
      queries_per_round: 1,
      max_sources: 5,
      max_reads: 0,
    });
    assert.equal(repairCalls, 1);
    assert.equal(result.diagnostics.languageValidation.checked, true);
    assert.equal(result.diagnostics.languageValidation.valid, true);
    assert.equal(result.diagnostics.languageValidation.repairAttempted, true);
  }
});

test("arbitrary languages are reported as unchecked instead of deterministically overclaimed", async () => {
  let repairCalls = 0;
  const client = {
    answer: async ({ question }) => {
      if (question.includes("Return ONLY a JSON array")) {
        return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
      }
      if (question.includes("Repair the citation markers")) repairCalls += 1;
      return { answer: "한국어 텍스트 [S1].", credits: 6 };
    },
    search: async () => ({
      credits: 3,
      webpages: [{ title: "Source", link: "https://example.com/source", summary: "Evidence" }],
    }),
    readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
  };

  const result = await runDeepResearch(client, {
    question: "test",
    language: "fr",
    depth: "quick",
    queries_per_round: 1,
    max_sources: 5,
    max_reads: 0,
  });
  assert.equal(repairCalls, 0);
  assert.equal(result.diagnostics.languageValidation.checked, false);
  assert.equal(result.diagnostics.languageValidation.valid, true);
  assert.equal(result.diagnostics.languageValidation.repairAttempted, false);
  assert.match(result.diagnostics.languageValidation.deterministicCheck, /no deterministic/);
});
