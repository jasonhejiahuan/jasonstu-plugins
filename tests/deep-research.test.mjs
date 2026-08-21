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
    search: async ({ query }) => ({
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
