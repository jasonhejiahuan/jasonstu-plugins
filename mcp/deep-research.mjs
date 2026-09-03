import { MetasoError } from "./metaso-client.mjs";

const ALLOWED_SCOPES = new Set(["webpage", "document", "scholar", "image", "video", "podcast"]);

const PRESETS = {
  quick: { iterations: 1, queriesPerRound: 2, maxSources: 12, maxReads: 3 },
  standard: { iterations: 2, queriesPerRound: 3, maxSources: 24, maxReads: 6 },
  deep: { iterations: 3, queriesPerRound: 4, maxSources: 40, maxReads: 10 },
};

function integerOption(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MetasoError(`${name} must be an integer from ${minimum} to ${maximum}`, {
      channel: "validation",
      code: "INVALID_ARGUMENT",
    });
  }
  return value;
}

function textFromAnswer(response) {
  if (!response || typeof response !== "object") return "";
  if (typeof response.answer === "string") return response.answer;
  if (typeof response.content === "string") return response.content;
  return response.choices?.[0]?.message?.content ?? "";
}

function creditsFrom(value) {
  if (!value || typeof value !== "object") return 0;
  return Number(value.credits ?? value.usage?.credits ?? 0) || 0;
}

function findJsonArray(text) {
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const value = JSON.parse(cleaned);
    if (
      Array.isArray(value) &&
      value.some((item) => typeof item === "string" || typeof item?.query === "string")
    ) {
      return value;
    }
  } catch {}

  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < cleaned.length; end += 1) {
      const character = cleaned[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "[") depth += 1;
      if (character !== "]") continue;
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const value = JSON.parse(cleaned.slice(start, end + 1));
        if (
          Array.isArray(value) &&
          value.some((item) => typeof item === "string" || typeof item?.query === "string")
        ) {
          return value;
        }
      } catch {}
      break;
    }
  }
  return null;
}

function outputLanguageName(language) {
  const normalized = String(language).trim().toLowerCase();
  if (/^en(?:[-_]|$)/.test(normalized) || normalized === "english") return "English";
  if (/^zh(?:[-_]|$)/.test(normalized) || /chinese|中文/.test(normalized)) {
    return "Simplified Chinese";
  }
  if (/^ja(?:[-_]|$)/.test(normalized) || normalized === "japanese") return "Japanese";
  if (/^ko(?:[-_]|$)/.test(normalized) || normalized === "korean") return "Korean";
  return String(language).trim() || "Simplified Chinese";
}

function fallbackQuerySuffixes(language, round) {
  const requested = outputLanguageName(language);
  const suffixes = {
    English: {
      initial: [
        "key facts and latest developments",
        "primary sources and authoritative evidence",
        "disputes and counterarguments",
        "statistics and case studies",
      ],
      followUp: [
        "remaining evidence gaps",
        "contrary findings and limitations",
        "latest primary sources",
        "verifiable data",
      ],
    },
    "Simplified Chinese": {
      initial: ["关键事实与最新进展", "权威研究与原始证据", "争议与反方观点", "统计数据与案例"],
      followUp: ["尚未解决的证据缺口", "相反结论与局限", "最新原始资料", "可验证数据"],
    },
    Japanese: {
      initial: ["主要な事実と最新動向", "一次資料と信頼できる根拠", "争点と反対意見", "統計データと事例"],
      followUp: ["未解決の証拠不足", "相反する調査結果と限界", "最新の一次資料", "検証可能なデータ"],
    },
    Korean: {
      initial: ["핵심 사실과 최신 동향", "1차 자료와 신뢰할 수 있는 근거", "쟁점과 반론", "통계와 사례"],
      followUp: ["남아 있는 근거 공백", "상반된 결과와 한계", "최신 1차 자료", "검증 가능한 데이터"],
    },
  };
  const neutral = {
    initial: [
      "key facts / latest developments",
      "primary sources / authoritative evidence",
      "disputes / counterarguments",
      "statistics / case studies",
    ],
    followUp: [
      "remaining evidence gaps",
      "contrary findings / limitations",
      "latest primary sources",
      "verifiable data",
    ],
  };
  const selected = suffixes[requested] ?? neutral;
  return round === 0 ? selected.initial : selected.followUp;
}

function normalizePlannedQueries(value, scopes, limit, question, round, language) {
  const normalized = [];
  for (const item of value ?? []) {
    const query = typeof item === "string" ? item : item?.query;
    let scope = typeof item === "object" ? item?.scope : undefined;
    if (scope === "paper") scope = "scholar";
    if (typeof query !== "string" || !query.trim()) continue;
    if (!ALLOWED_SCOPES.has(scope)) scope = scopes[normalized.length % scopes.length];
    const key = `${scope}\n${query.trim().toLowerCase()}`;
    if (normalized.some((entry) => entry.key === key)) continue;
    normalized.push({ query: query.trim(), scope, key });
    if (normalized.length >= limit) break;
  }
  if (normalized.length) return normalized.map(({ key: _key, ...entry }) => entry);

  const suffixes = fallbackQuerySuffixes(language, round);
  return Array.from({ length: limit }, (_, index) => ({
    query: `${question} ${suffixes[index % suffixes.length]}`,
    scope: scopes[index % scopes.length],
  }));
}

function searchItems(response, scope) {
  const keys = {
    webpage: "webpages",
    document: "documents",
    scholar: "scholars",
    image: "images",
    video: "videos",
    podcast: "podcasts",
  };
  const items = response?.[keys[scope]];
  return Array.isArray(items) ? items : [];
}

function sourceUrl(item) {
  return item?.link ?? item?.url ?? item?.imageUrl ?? null;
}

function sourceSnippet(item) {
  return item?.summary ?? item?.snippet ?? item?.content ?? "";
}

function compactEvidence(sources, maximumCharacters = 18_000) {
  let text = "";
  for (const source of sources) {
    const block = `[${source.id}] ${source.title || "Untitled"}\nScope: ${source.scope}\nURL: ${source.url || "n/a"}\nEvidence: ${source.snippet || "n/a"}\n\n`;
    if (text.length + block.length > maximumCharacters) break;
    text += block;
  }
  return text;
}

function sourceRegistry(sources) {
  return sources
    .filter((source) => source.url)
    .map((source) => `- [${source.id}] [${source.title || source.url}](${source.url})`)
    .join("\n");
}

function nativeCitationIndexes(report) {
  return new Set(
    [...String(report).matchAll(/\[\[(\d+)\]\]/g)].map((match) => Number(match[1])),
  );
}

function mergeAnswerSources(response, sources, sourceKeys, maximumSources, report) {
  const candidates = Array.isArray(response?.sources) && response.sources.length
    ? response.sources
    : Array.isArray(response?.citations)
      ? response.citations
      : [];
  const citationIds = new Map();
  const protectedIds = new Set(
    [...String(report).matchAll(/\[S(\d+)\]/g)].map((match) => `S${Number(match[1])}`),
  );
  for (const citationIndex of nativeCitationIndexes(report)) {
    const item = candidates[citationIndex - 1];
    if (!item) continue;
    const url = item?.link ?? item?.url;
    if (!url) continue;
    let source = sources.find((candidate) => candidate.url === url);
    if (!source && sources.length < maximumSources) {
      sourceKeys.add(url);
      source = {
        id: `S${sources.length + 1}`,
        scope: "answer",
        query: "final synthesis",
        title: item.title ?? url,
        url,
        snippet: String(item.summary ?? item.snippet ?? "").slice(0, 4_000),
        date: item.date ?? null,
        authors: item.authors ?? null,
        score: item.score ?? null,
      };
      sources.push(source);
    } else if (!source) {
      const replaceIndex = sources.findIndex((candidate) => !protectedIds.has(candidate.id));
      if (replaceIndex !== -1) {
        const replaced = sources[replaceIndex];
        if (replaced.url) sourceKeys.delete(replaced.url);
        source = {
          id: replaced.id,
          scope: "answer",
          query: "final synthesis",
          title: item.title ?? url,
          url,
          snippet: String(item.summary ?? item.snippet ?? "").slice(0, 4_000),
          date: item.date ?? null,
          authors: item.authors ?? null,
          score: item.score ?? null,
        };
        sources[replaceIndex] = source;
        sourceKeys.add(url);
      }
    }
    if (source) {
      citationIds.set(citationIndex, source.id);
      protectedIds.add(source.id);
    }
  }
  return citationIds;
}

function normalizeAutomaticCitations(report, citationIds) {
  return String(report).replace(/\[\[(\d+)\]\]/g, (marker, rawIndex) => {
    const sourceId = citationIds.get(Number(rawIndex));
    return sourceId ? `[${sourceId}]` : marker;
  });
}

function auditCitationIds(report, sources) {
  const references = [...String(report).matchAll(/\[S(\d+)\]/g)].map((match) => Number(match[1]));
  const unresolvedNative = [...nativeCitationIndexes(report)].sort((a, b) => a - b);
  const allowed = new Set(sources.map((source) => Number(String(source.id).replace(/^S/, ""))));
  const invalidIds = [...new Set(references.filter((id) => !allowed.has(id)))].sort((a, b) => a - b);
  const missingCitations = sources.length > 0 && references.length === 0;
  return {
    valid: invalidIds.length === 0 && !missingCitations && unresolvedNative.length === 0,
    citedIds: [...new Set(references)].sort((a, b) => a - b).map((id) => `S${id}`),
    invalidIds: invalidIds.map((id) => `S${id}`),
    unmappedNativeCitations: unresolvedNative.map((id) => `[[${id}]]`),
    missingCitations,
  };
}

function auditOutputLanguage(report, language) {
  const requested = outputLanguageName(language);
  const value = String(report)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\[S\d+\]|\[\[\d+\]\]/gi, " ");
  const latinLetters = (value.match(/[A-Za-z\u00c0-\u024f]/g) ?? []).length;
  const hanCharacters = (value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const kanaCharacters = (value.match(/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/g) ?? []).length;
  const hangulCharacters = (
    value.match(/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/g) ?? []
  ).length;
  const cjkCharacters = hanCharacters + kanaCharacters + hangulCharacters;
  const scriptCharacters = latinLetters + cjkCharacters;
  const ratio = (count) => (scriptCharacters ? count / scriptCharacters : 0);
  const common = {
    requested,
    latinLetters,
    cjkCharacters,
    hanCharacters,
    kanaCharacters,
    hangulCharacters,
    scriptCharacters,
  };

  if (requested === "English") {
    const targetScriptRatio = ratio(latinLetters);
    return {
      ...common,
      checked: true,
      valid:
        scriptCharacters === 0 ||
        (latinLetters > 0 && (cjkCharacters <= 2 || targetScriptRatio >= 0.65)),
      targetScriptRatio,
      deterministicCheck:
        "script-ratio check for English versus Han, Kana, and Hangul; Latin-script languages are not distinguished",
    };
  }

  if (requested === "Simplified Chinese") {
    const targetScriptRatio = ratio(hanCharacters);
    const incompatibleScriptRatio = ratio(kanaCharacters + hangulCharacters);
    return {
      ...common,
      checked: true,
      valid:
        scriptCharacters === 0 ||
        (hanCharacters > 0 && targetScriptRatio >= 0.35 && incompatibleScriptRatio < 0.2),
      targetScriptRatio,
      incompatibleScriptRatio,
      deterministicCheck:
        "script-ratio check for Han-dominant Chinese; it cannot distinguish Simplified from Traditional Chinese",
    };
  }

  if (requested === "Japanese") {
    const japaneseCharacters = hanCharacters + kanaCharacters;
    const targetScriptRatio = ratio(japaneseCharacters);
    return {
      ...common,
      checked: true,
      valid:
        scriptCharacters === 0 ||
        (kanaCharacters > 0 && targetScriptRatio >= 0.55 && ratio(hangulCharacters) < 0.15),
      targetScriptRatio,
      deterministicCheck: "script-ratio check requiring Japanese Kana with predominantly Han/Kana text",
    };
  }

  if (requested === "Korean") {
    const targetScriptRatio = ratio(hangulCharacters);
    return {
      ...common,
      checked: true,
      valid: scriptCharacters === 0 || (hangulCharacters > 0 && targetScriptRatio >= 0.5),
      targetScriptRatio,
      deterministicCheck: "script-ratio check requiring predominantly Hangul text",
    };
  }

  return {
    ...common,
    checked: false,
    valid: true,
    deterministicCheck: "no deterministic script validation is claimed for this language",
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length || 1) }, worker));
  return results;
}

function buildPlannerPrompt({ question, language, scopes, round, limit, evidence }) {
  const firstRound = round === 0;
  const outputLanguage = outputLanguageName(language);
  return [
    "You are planning a source-grounded research task.",
    `Research question: ${question}`,
    `Output language: ${outputLanguage}. Use ${outputLanguage} for every query and all text values.`,
    `Allowed scopes: ${scopes.join(", ")}`,
    firstRound
      ? "Create diverse queries covering definitions, primary evidence, current facts, and counterarguments."
      : "Use the evidence summary to identify unresolved gaps, contradictions, or missing primary sources.",
    evidence ? `Evidence gathered so far:\n${evidence}` : "",
    `Return ONLY a JSON array with at most ${limit} objects. Each object must have exactly {"query":"...","scope":"..."}.`,
    "Do not add Markdown fences or explanatory prose.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSynthesisPrompt({
  question,
  language,
  sources,
  readerEvidence,
  maxSources,
  draft,
  critique,
}) {
  const outputLanguage = outputLanguageName(language);
  const snippets = compactEvidence(sources, 45_000);
  const fullText = readerEvidence
    .map(
      (entry) =>
        `[${entry.sourceId}] FULL TEXT EXCERPT\n${entry.markdown.slice(0, 8_000)}\n`,
    )
    .join("\n")
    .slice(0, 60_000);
  return [
    `MANDATORY OUTPUT LANGUAGE: ${outputLanguage}. Write the entire response only in ${outputLanguage}.`,
    "Produce a rigorous, source-grounded deep research report.",
    `Question: ${question}`,
    `Write in: ${outputLanguage}`,
    "Use only the supplied evidence for factual claims. Cite evidence inline as [S1], [S2], etc.",
    `Use no more than ${maxSources} unique cited sources.`,
    "Clearly separate confirmed facts, reasonable inferences, conflicting evidence, limitations, and unanswered questions.",
    "Do not invent citations. Do not cite a source ID that is absent from the evidence.",
    "Start with an executive answer, then present findings, counterarguments, limitations, and conclusion.",
    draft ? `Earlier draft to improve:\n${draft.slice(0, 28_000)}` : "",
    critique ? `Independent critique to address:\n${critique.slice(0, 16_000)}` : "",
    `SEARCH EVIDENCE:\n${snippets}`,
    fullText ? `READER EXCERPTS:\n${fullText}` : "",
    `Final reminder: output only ${outputLanguage}; do not switch languages because a source uses another language.`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 125_000);
}

export async function runDeepResearch(client, input = {}) {
  const question = String(input.question ?? "").trim();
  if (!question) {
    throw new MetasoError("question must be a non-empty string", {
      channel: "validation",
      code: "INVALID_ARGUMENT",
    });
  }
  const depth = input.depth ?? "standard";
  if (!Object.hasOwn(PRESETS, depth)) {
    throw new MetasoError("depth must be quick, standard, or deep", {
      channel: "validation",
      code: "INVALID_DEPTH",
    });
  }
  const preset = PRESETS[depth];
  const language = String(input.language ?? "zh");
  const scopes = (input.scopes ?? ["webpage", "scholar", "document"]).map((scope) =>
    scope === "paper" ? "scholar" : scope,
  );
  if (!scopes.length || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    throw new MetasoError("scopes contains an unsupported search scope", {
      channel: "validation",
      code: "INVALID_SCOPE",
    });
  }
  const iterations = integerOption(
    input.max_iterations,
    preset.iterations,
    1,
    4,
    "max_iterations",
  );
  const queriesPerRound = integerOption(
    input.queries_per_round,
    preset.queriesPerRound,
    1,
    6,
    "queries_per_round",
  );
  const maxSources = integerOption(input.max_sources, preset.maxSources, 5, 60, "max_sources");
  const maxReads = integerOption(input.max_reads, preset.maxReads, 0, 15, "max_reads");
  const model = input.model ?? (depth === "deep" ? "fast_thinking" : "fast");
  const synthesisCalls = depth === "deep" ? 3 : 1;
  const estimatedCallUpperBound =
    iterations * (1 + queriesPerRound) + maxReads + synthesisCalls + 1;
  const highCost =
    depth === "deep" ||
    estimatedCallUpperBound > 18 ||
    maxSources > 30 ||
    maxReads > 8;
  if (highCost && input.allow_high_cost !== true) {
    throw new MetasoError(
      "This research configuration can make many billable calls. Set allow_high_cost=true after the user explicitly requests deep/high-cost research.",
      {
        channel: "validation",
        code: "HIGH_COST_CONFIRMATION_REQUIRED",
        details: {
          estimatedCallUpperBound,
          iterations,
          queriesPerRound,
          maxSources,
          maxReads,
        },
      },
    );
  }

  const queryPlan = [];
  const sources = [];
  const sourceKeys = new Set();
  const failures = [];
  let creditsObserved = 0;

  for (let round = 0; round < iterations; round += 1) {
    const plannerResponse = await client.answer({
      question: buildPlannerPrompt({
        question,
        language,
        scopes,
        round,
        limit: queriesPerRound,
        evidence: round ? compactEvidence(sources, 12_000) : "",
      }),
      scope: "webpage",
      model: "fast",
      format: "simple",
      stream: false,
      concise_snippet: true,
    });
    creditsObserved += creditsFrom(plannerResponse);
    const planned = normalizePlannedQueries(
      findJsonArray(textFromAnswer(plannerResponse)),
      scopes,
      queriesPerRound,
      question,
      round,
      language,
    );
    queryPlan.push({ round: round + 1, queries: planned });

    const remaining = Math.max(1, maxSources - sources.length);
    const size = Math.max(1, Math.min(5, Math.ceil(remaining / planned.length)));
    const searchResults = await mapWithConcurrency(planned, 3, async (plan) => {
      try {
        const result = await client.search({
          query: plan.query,
          scope: plan.scope,
          size,
          include_summary: plan.scope === "webpage",
          include_raw_content: false,
          concise_snippet: true,
        });
        return { plan, result };
      } catch (error) {
        failures.push({
          stage: "search",
          query: plan.query,
          scope: plan.scope,
          error: error instanceof MetasoError ? error.toJSON() : String(error),
        });
        return { plan, result: null };
      }
    });

    for (const { plan, result } of searchResults) {
      if (!result) continue;
      creditsObserved += creditsFrom(result);
      for (const item of searchItems(result, plan.scope)) {
        const url = sourceUrl(item);
        const key = url || `${plan.scope}:${item.title ?? JSON.stringify(item)}`;
        if (sourceKeys.has(key)) continue;
        sourceKeys.add(key);
        sources.push({
          id: `S${sources.length + 1}`,
          scope: plan.scope,
          query: plan.query,
          title: item.title ?? "Untitled",
          url,
          snippet: String(sourceSnippet(item)).slice(0, 4_000),
          date: item.date ?? null,
          authors: item.authors ?? null,
          score: item.score ?? null,
        });
        if (sources.length >= maxSources) break;
      }
      if (sources.length >= maxSources) break;
    }
    if (sources.length >= maxSources) break;
  }

  const readableSources = sources
    .filter((source) => source.scope !== "image" && /^https?:\/\//i.test(source.url ?? ""))
    .slice(0, maxReads);
  const readerEvidence = (
    await mapWithConcurrency(readableSources, 2, async (source) => {
      try {
        const result = await client.readUrl({ url: source.url, format: "json" });
        creditsObserved += creditsFrom(result);
        return {
          sourceId: source.id,
          title: result.title ?? source.title,
          markdown: String(result.markdown ?? ""),
        };
      } catch (error) {
        failures.push({
          stage: "reader",
          sourceId: source.id,
          url: source.url,
          error: error instanceof MetasoError ? error.toJSON() : String(error),
        });
        return null;
      }
    })
  ).filter(Boolean);

  let draft = "";
  let critique = "";
  if (depth === "deep") {
    const draftResponse = await client.answer({
      question: buildSynthesisPrompt({
        question,
        language,
        sources,
        readerEvidence,
        maxSources,
      }),
      scope: "webpage",
      model,
      format: "simple",
      stream: false,
    });
    creditsObserved += creditsFrom(draftResponse);
    draft = textFromAnswer(draftResponse);

    const critiqueResponse = await client.answer({
      question: [
        "Audit this research draft for unsupported claims, missing counterarguments, stale evidence, and citation mismatches.",
        "Return a concise correction plan. Do not rewrite the full report.",
        `Write only in ${outputLanguageName(language)}.`,
        `Research question: ${question}`,
        `Draft:\n${draft.slice(0, 35_000)}`,
        `Available sources:\n${sourceRegistry(sources)}`,
      ].join("\n\n"),
      scope: "scholar",
      model: "fast",
      format: "simple",
      stream: false,
    });
    creditsObserved += creditsFrom(critiqueResponse);
    critique = textFromAnswer(critiqueResponse);
  }

  const finalResponse = await client.answer({
    question: buildSynthesisPrompt({
      question,
      language,
      sources,
      readerEvidence,
      maxSources,
      draft,
      critique,
    }),
    scope: "webpage",
    model,
    format: "simple",
    stream: false,
  });
  creditsObserved += creditsFrom(finalResponse);
  const rawAnswer = textFromAnswer(finalResponse);
  const finalCitationIds = mergeAnswerSources(
    finalResponse,
    sources,
    sourceKeys,
    maxSources,
    rawAnswer,
  );
  let answer = normalizeAutomaticCitations(
    rawAnswer,
    finalCitationIds,
  ).trim();
  let citationValidation = auditCitationIds(answer, sources);
  let languageValidation = auditOutputLanguage(answer, language);
  let citationRepairAttempted = false;
  let languageRepairAttempted = false;
  if ((!citationValidation.valid && sources.length > 0) || !languageValidation.valid) {
    citationRepairAttempted = !citationValidation.valid && sources.length > 0;
    languageRepairAttempted = !languageValidation.valid;
    const repairResponse = await client.answer({
      question: [
        "Repair the citation markers in this research report.",
        "Return the complete report, not a commentary about it.",
        `Write the entire report only in ${outputLanguageName(language)}.`,
        `Use no more than ${maxSources} unique cited sources.`,
        "Every factual section must cite one or more valid source IDs. Use only IDs present in the registry.",
        "Remove unsupported or unknown citation IDs. Do not invent sources.",
        `Valid source registry:\n${sourceRegistry(sources)}`,
        `Report to repair:\n${answer.slice(0, 80_000)}`,
      ].join("\n\n"),
      scope: "webpage",
      model: "fast",
      format: "simple",
      stream: false,
    });
    creditsObserved += creditsFrom(repairResponse);
    const rawRepaired = textFromAnswer(repairResponse);
    const repairCitationIds = mergeAnswerSources(
      repairResponse,
      sources,
      sourceKeys,
      maxSources,
      rawRepaired,
    );
    const repaired = normalizeAutomaticCitations(
      rawRepaired,
      repairCitationIds,
    ).trim();
    const repairedValidation = auditCitationIds(repaired, sources);
    const repairedLanguageValidation = auditOutputLanguage(repaired, language);
    if (repaired) {
      answer = repaired;
      citationValidation = repairedValidation;
      languageValidation = repairedLanguageValidation;
    }
  }
  const warnings = [];
  if (!citationValidation.valid) {
    if (citationValidation.missingCitations) {
      warnings.push("the generated report did not cite the available source IDs");
    }
    if (citationValidation.invalidIds.length) {
      warnings.push(`unknown source IDs remain (${citationValidation.invalidIds.join(", ")})`);
    }
    if (citationValidation.unmappedNativeCitations.length) {
      warnings.push(
        `unmapped native citation markers remain (${citationValidation.unmappedNativeCitations.join(", ")})`,
      );
    }
  }
  if (!languageValidation.valid) {
    warnings.push(`the report is not predominantly in requested language ${languageValidation.requested}`);
  }
  if (warnings.length) {
    answer = `> **Validation warning: ${warnings.join("; ")}.**\n\n${answer}`;
  }
  const registry = sourceRegistry(sources);
  const report = `${answer || "No report was returned."}\n\n## Sources\n\n${registry || "No usable sources were returned."}`;

  return {
    report,
    sources,
    diagnostics: {
      depth,
      language,
      model,
      iterationsRequested: iterations,
      roundsCompleted: queryPlan.length,
      queryPlan,
      sourceCount: sources.length,
      readerCount: readerEvidence.length,
      failures,
      creditsObserved,
      estimatedCallUpperBound,
      citationValidation: {
        ...citationValidation,
        repairAttempted: citationRepairAttempted,
        semanticSupport: depth === "deep" ? "model critique plus deterministic ID validation" : "deterministic ID validation",
      },
      languageValidation: {
        ...languageValidation,
        repairAttempted: languageRepairAttempted,
      },
      costNote: "creditsObserved sums credits fields returned by calls; billing rules may change.",
    },
  };
}
