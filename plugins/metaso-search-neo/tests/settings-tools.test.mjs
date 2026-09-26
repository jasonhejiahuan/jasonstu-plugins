import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginSettings } from "../mcp/settings.mjs";
import { callTool, listTools } from "../mcp/tools.mjs";

async function temporarySettings() {
  const directory = await mkdtemp(join(tmpdir(), "metaso-settings-test-"));
  return {
    directory,
    settings: new PluginSettings({ path: join(directory, "settings.json") }),
  };
}

test("tool list exposes the complete stable surface", () => {
  const names = new Set(listTools().map((tool) => tool.name));
  for (const required of [
    "metaso_search",
    "metaso_read_url",
    "metaso_answer",
    "metaso_research",
    "metaso_deep_research",
    "metaso_research_frontier",
    "metaso_resource_catalog",
    "metaso_topic_create",
    "metaso_topic_upload_directory",
    "metaso_bookshelf_upload",
  ]) {
    assert.equal(names.has(required), true, `${required} should exist`);
  }
  assert.equal(names.size, 20);
});

test("non-research mutations do not consume the first-answer Frontier notice", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      createTopic: async () => ({ id: "topic-1", dirRootId: "dir-1", name: "Topic" }),
      search: async () => ({ credits: 3, webpages: [] }),
    };
    const context = { client, settings: fixture.settings };
    const created = await callTool("metaso_topic_create", { name: "Topic" }, context);
    const searched = await callTool("metaso_search", { q: "answer" }, context);
    assert.doesNotMatch(created.content[0].text, /Research Frontier/);
    assert.match(searched.content[0].text, /Research Frontier/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("server-side schema validation rejects undeclared and ambiguous arguments", async () => {
  const fixture = await temporarySettings();
  try {
    const context = { client: {}, settings: fixture.settings };
    const extra = await callTool("metaso_search", { q: "x", unsupported: true }, context);
    const ambiguous = await callTool(
      "metaso_answer",
      { question: "x", messages: [{ role: "user", content: "x" }] },
      context,
    );
    const duplicateDelete = await callTool(
      "metaso_file_delete",
      { file_ids: ["same", "same"] },
      context,
    );
    const ambiguousBook = await callTool(
      "metaso_bookshelf_upload",
      { source_type: "file", file_path: "/tmp/a", url: "https://example.com" },
      context,
    );
    for (const result of [extra, ambiguous, duplicateDelete, ambiguousBook]) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.code, "SCHEMA_VALIDATION_FAILED");
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("plugin-local resource catalog preserves exact IDs for later deletion", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      createTopic: async () => ({ id: "topic-1", dirRootId: "dir-1", name: "Topic" }),
      uploadTopicFile: async () => [{ id: "file-1", parentId: "dir-1" }],
    };
    const context = { client, settings: fixture.settings };
    await callTool("metaso_topic_create", { name: "Topic" }, context);
    await callTool(
      "metaso_topic_upload",
      { dir_root_id: "dir-1", file_path: "/tmp/notes.md" },
      context,
    );
    const catalog = await callTool("metaso_resource_catalog", { kind: "all" }, context);
    assert.equal(catalog.structuredContent.topics[0].id, "topic-1");
    assert.equal(catalog.structuredContent.files[0].fileId, "file-1");
    assert.equal(catalog.structuredContent.files[0].fileName, "notes.md");
    assert.equal(catalog.structuredContent.files[0].topicId, "topic-1");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("directory uploads retain local basenames when API entries contain only IDs", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      uploadTopicDirectory: async () => ({
        discovered: 2,
        uploaded: [
          { path: "/tmp/alpha.md", files: [{ id: "file-a" }] },
          { path: "/tmp/nested/beta.pdf", files: [{ id: "file-b" }] },
        ],
        failures: [],
      }),
    };
    const result = await callTool(
      "metaso_topic_upload_directory",
      { dir_root_id: "dir-1", directory_path: "/tmp" },
      { client, settings: fixture.settings },
    );
    assert.equal(result.isError, undefined);
    const catalog = await fixture.settings.resourceCatalog("files");
    assert.deepEqual(
      catalog.files.map((file) => file.fileName).sort(),
      ["alpha.md", "beta.pdf"],
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("topic deletion removes cataloged files linked by topic and root directory", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      createTopic: async () => ({ id: "topic-1", dirRootId: "dir-1", name: "Topic" }),
      uploadTopicFile: async () => [
        { id: "file-1", fileName: "notes.md", parentId: "dir-1" },
      ],
      deleteTopics: async () => ({ success: true }),
    };
    const context = { client, settings: fixture.settings };
    await callTool("metaso_topic_create", { name: "Topic" }, context);
    await callTool(
      "metaso_topic_upload",
      { dir_root_id: "dir-1", file_path: "/tmp/notes.md" },
      context,
    );
    await callTool("metaso_topic_delete", { topic_ids: ["topic-1"] }, context);
    const catalog = await callTool("metaso_resource_catalog", { kind: "all" }, context);
    assert.deepEqual(catalog.structuredContent.topics, []);
    assert.deepEqual(catalog.structuredContent.files, []);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("successful upload remains successful when readiness polling fails", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      uploadTopicFile: async () => [
        { id: "file-1", fileName: "notes.md", parentId: "dir-1" },
      ],
      waitFilesReady: async () => {
        throw new Error("poll timeout");
      },
    };
    const result = await callTool(
      "metaso_topic_upload",
      {
        dir_root_id: "dir-1",
        file_path: "/tmp/notes.md",
        wait_until_ready: true,
      },
      { client, settings: fixture.settings },
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent.fileIds, ["file-1"]);
    assert.equal(result.structuredContent.readiness, null);
    assert.match(result.structuredContent.readinessError.note, /Do not repeat the upload/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("malformed global state is preserved before defaults are restored", async () => {
  const fixture = await temporarySettings();
  try {
    const path = join(fixture.directory, "settings.json");
    await writeFile(path, "{not-json", "utf8");
    const current = await fixture.settings.read();
    assert.equal(current.researchFrontier, false);
    assert.match(fixture.settings.warning, /preserved/);
    const entries = await readdir(fixture.directory);
    assert.equal(entries.some((name) => name.startsWith("settings.json.corrupt-")), true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("concurrent malformed-state reads recover without rename races", async () => {
  const fixture = await temporarySettings();
  try {
    const path = join(fixture.directory, "settings.json");
    await writeFile(path, "{not-json", "utf8");
    const results = await Promise.all(
      Array.from({ length: 20 }, () => fixture.settings.read()),
    );
    assert.equal(results.every((state) => state.researchFrontier === false), true);
    const entries = await readdir(fixture.directory);
    assert.equal(entries.filter((name) => name.startsWith("settings.json.corrupt-")).length, 1);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("first successful research call emits exactly one Frontier notice", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      search: async () => ({ credits: 3, webpages: [] }),
    };
    const context = { client, settings: fixture.settings };
    const first = await callTool("metaso_search", { q: "first" }, context);
    const second = await callTool("metaso_search", { q: "second" }, context);
    assert.match(first.content[0].text, /Research Frontier/);
    assert.equal(first.structuredContent.pluginNotice.includes("前沿研究模式"), true);
    assert.doesNotMatch(second.content[0].text, /Research Frontier/);
    const stored = JSON.parse(await readFile(join(fixture.directory, "settings.json"), "utf8"));
    assert.equal(stored.firstUseNoticeShown, true);
    assert.equal(stored.researchFrontier, false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Research Frontier persists globally and changes only unspecified defaults", async () => {
  const fixture = await temporarySettings();
  const calls = [];
  try {
    const client = {
      answer: async (args) => {
        calls.push(args);
        return { answer: "ok", credits: 6 };
      },
    };
    const context = { client, settings: fixture.settings };
    await callTool("metaso_research_frontier", { action: "enable" }, context);
    await callTool("metaso_answer", { question: "default" }, context);
    await callTool("metaso_answer", { question: "explicit", model: "ds-r1" }, context);
    assert.equal(calls[0].model, "fast_thinking");
    assert.equal(calls[1].model, "ds-r1");
    const freshReader = new PluginSettings({ path: join(fixture.directory, "settings.json") });
    assert.equal((await freshReader.read()).researchFrontier, true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("explicit quick depth overrides Research Frontier deep defaults", async () => {
  const fixture = await temporarySettings();
  try {
    const client = {
      answer: async ({ question }) => {
        if (question.includes("Return ONLY a JSON array")) {
          return { answer: '[{"query":"evidence","scope":"webpage"}]', credits: 6 };
        }
        return { answer: "Supported answer [S1].", credits: 6 };
      },
      search: async () => ({
        credits: 3,
        webpages: [{ title: "Source", link: "https://example.com", summary: "Evidence" }],
      }),
      readUrl: async () => assert.fail("max_reads=0 should skip Reader"),
    };
    const context = { client, settings: fixture.settings };
    await callTool("metaso_research_frontier", { action: "enable" }, context);
    const result = await callTool(
      "metaso_deep_research",
      {
        question: "quick request",
        depth: "quick",
        queries_per_round: 1,
        max_sources: 5,
        max_reads: 0,
      },
      context,
    );
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.diagnostics.depth, "quick");
    assert.equal(result.structuredContent.diagnostics.roundsCompleted, 1);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
