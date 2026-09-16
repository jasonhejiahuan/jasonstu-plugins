import test from "node:test";
import assert from "node:assert/strict";
import { runDeepResearch } from "../mcp/deep-research.mjs";
import { callTool, listTools } from "../mcp/tools.mjs";
import { validateToolArguments } from "../mcp/schema.mjs";

const settings = {
  read: async () => ({ researchFrontier: true }),
  consumeFirstUseNotice: async () => ({ notice: null }),
};

test("Frontier defaults to API maximum search size and preserves caller budgets", async () => {
  const calls = [];
  const client = { search: async (args) => { calls.push(args); return { webpages: [] }; } };
  for (const args of [{ q: "a" }, { q: "b", size: 10 }, { q: "c", page: "2" }]) {
    const result = await callTool("metaso_search", args, { client, settings });
    assert.equal(result.isError, undefined);
  }
  assert.equal(calls[0].size, 100);
  assert.equal(calls[1].size, 10);
  assert.equal(calls[2].size, undefined);
  assert.equal(calls[2].page, "2");
});

test("Frontier exceeds old round/source/Reader caps and stops when evidence is sufficient", async () => {
  let planners = 0;
  const searches = [];
  const reads = [];
  const client = {
    answer: async ({ question }) => {
      if (question.startsWith("You are planning")) {
        planners += 1;
        return { answer: planners <= 6 ? JSON.stringify([{ query: `gap ${planners}`, scope: "webpage" }]) : "[]" };
      }
      if (question.startsWith("Select Reader")) {
        // Choose distinct primary evidence from every batch; skip the remainder.
        const candidates = [...question.matchAll(/\[(S\d+)\] Source/g)].map((match) => match[1]);
        return { answer: JSON.stringify(candidates.slice(0, 4)) };
      }
      return { answer: "The evidence supports the conclusion [S1]." };
    },
    search: async ({ q, size }) => {
      searches.push({ q, size });
      return { webpages: Array.from({ length: 20 }, (_, i) => ({ title: `Source ${q} ${i}`, link: `https://example.com/${q.replaceAll(" ", "-")}/${i}`, snippet: "Primary evidence" })) };
    },
    readUrl: async ({ url }) => { reads.push(url); return { markdown: "Verified primary evidence." }; },
  };
  const result = await callTool("metaso_deep_research", { question: "Compare the evidence", language: "en" }, { client, settings });
  assert.equal(result.isError, undefined);
  const d = result.structuredContent.diagnostics;
  assert.equal(d.roundsCompleted, 6);
  assert.equal(d.sourceCount, 120);
  assert.equal(d.readerCount, 20);
  assert.equal(new Set(reads).size, 20);
  assert.equal(searches.every((call) => call.size === 100), true);
  assert.equal(d.stopReason, "planner_satisfied");
  assert.deepEqual(d.resourceLimits, { rounds: null, sources: null, reads: null });
  assert.equal(d.estimatedCallUpperBound, null);
});

test("adaptive research stops before repeating queries or fetching duplicate pages", async () => {
  let searches = 0;
  const result = await runDeepResearch({
    answer: async ({ question }) => ({ answer: question.startsWith("You are planning") ? '[{"query":"same","scope":"webpage"}]' : "The conclusion is supported [S1]." }),
    search: async () => { searches += 1; return { webpages: [{ title: "Source", link: "https://example.com/a", snippet: "Evidence" }] }; },
    readUrl: async () => assert.fail("explicit max_reads=0 must win"),
  }, { question: "test", language: "en", max_iterations: null, max_sources: null, max_reads: 0, allow_high_cost: true });
  assert.equal(searches, 1);
  assert.equal(result.diagnostics.stopReason, "repeated_queries");
});

test("no-new-evidence stopping and invalid follow-up plans do not loop indefinitely", async () => {
  for (const invalidPlan of [false, true]) {
    let planners = 0;
    let searches = 0;
    const result = await runDeepResearch({
      answer: async ({ question }) => {
        if (!question.startsWith("You are planning")) return { answer: "The conclusion is supported [S1]." };
        planners += 1;
        return { answer: invalidPlan && planners > 1 ? "Malformed output" : JSON.stringify([{ query: `new ${planners}`, scope: "webpage" }]) };
      },
      search: async () => { searches += 1; return { webpages: [{ title: "Same source", link: "https://example.com/a", snippet: "Evidence" }] }; },
    }, { question: "test", language: "en", max_iterations: null, max_sources: null, max_reads: 0, allow_high_cost: true });
    assert.equal(searches, invalidPlan ? 1 : 2);
    assert.equal(result.diagnostics.stopReason, invalidPlan ? "invalid_plan" : "no_new_sources");
  }
});

test("resource schema accepts null and budgets beyond old local maxima", async () => {
  const tool = listTools().find((item) => item.name === "metaso_deep_research");
  validateToolArguments(tool, { question: "test", max_iterations: null, max_sources: null, max_reads: null });
  validateToolArguments(tool, { question: "test", max_iterations: 12, max_sources: 500, max_reads: 120, queries_per_round: 10 });
  assert.throws(() => validateToolArguments(tool, { question: "test", max_iterations: 0 }));
  await assert.rejects(runDeepResearch({}, { question: "test", max_iterations: null }), { code: "HIGH_COST_CONFIRMATION_REQUIRED" });
});
