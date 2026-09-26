import test from "node:test";
import assert from "node:assert/strict";
import { MetasoClient, MetasoError, parseSseText, redactSecrets } from "../mcp/metaso-client.mjs";

function response(body, options = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: options.status ?? 200,
    headers: {
      "content-type": options.contentType ?? "application/json",
      ...(options.headers ?? {}),
    },
  });
}

test("search sends scholar and preserves structured response", async () => {
  let captured;
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({ credits: 3, scholars: [{ title: "Paper" }], total: 1 });
    },
  });
  const result = await client.search({ q: "test", scope: "scholar", size: 10 });
  assert.equal(captured.url, "https://metaso.cn/api/v1/search");
  assert.equal(captured.body.scope, "scholar");
  assert.equal(captured.options.headers.Authorization, "Bearer test-key");
  assert.equal(result.scholars[0].title, "Paper");
});

test("search rejects mutually exclusive size and page before network", async () => {
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => assert.fail("fetch should not run"),
  });
  await assert.rejects(
    client.search({ q: "test", size: 10, page: 1 }),
    (error) => error instanceof MetasoError && error.code === "MUTUALLY_EXCLUSIVE",
  );
});

test("HTTP 200 business errors are rejected", async () => {
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response({ errCode: 2005, errMsg: "API密钥无效" }),
  });
  await assert.rejects(
    client.search({ q: "test" }),
    (error) => error instanceof MetasoError && error.code === 2005 && error.channel === "business",
  );
});

test("missing API Key points users to the cross-platform connection flow", () => {
  const client = new MetasoClient({ apiKey: "" });
  assert.throws(
    () => client.requireApiKey(),
    (error) =>
      error instanceof MetasoError &&
      error.code === "MISSING_API_KEY" &&
      error.message.includes("metaso_auth_start") &&
      error.message.includes("node scripts/auth.mjs"),
  );
});

test("client reports when credentials were loaded from macOS Keychain", () => {
  const key = `mk-${"x".repeat(32)}`;
  const client = new MetasoClient({
    environment: {},
    credentialStore: { read: () => null },
    keychainLoader: () => ({ key, profile: "work" }),
  });
  assert.equal(client.apiKey, key);
  assert.equal(client.capabilities().credentialSource, "macos_keychain");
  assert.equal(client.capabilities().credentialProfile, "work");
});

test("explicit and environment keys take priority without accessing credential storage", () => {
  const credentialStore = { read: () => assert.fail("storage must not be read") };
  const explicit = new MetasoClient({ apiKey: "explicit", environment: { METASO_API_KEY: "env" }, credentialStore });
  const environment = new MetasoClient({ environment: { METASO_API_KEY: "env" }, credentialStore });
  assert.equal(explicit.apiKey, "explicit");
  assert.equal(explicit.capabilities().credentialSource, "explicit");
  assert.equal(environment.apiKey, "env");
  assert.equal(environment.capabilities().credentialSource, "environment");
});

test("credentials connect and rotate without restarting the client", async () => {
  let saved = null;
  const headers = [];
  const client = new MetasoClient({
    environment: {},
    credentialStore: { path: "/private/test/credential.json", read: () => saved },
    keychainLoader: () => ({ key: "legacy-key", profile: "old" }),
    fetchImpl: async (_url, options) => { headers.push(options.headers.Authorization); return response({}); },
  });
  assert.equal(client.capabilities().credentialSource, "macos_keychain");
  saved = { key: `mk-${"a".repeat(32)}`, name: "new" };
  const capabilities = client.capabilities();
  assert.equal(capabilities.credentialSource, "plugin_file");
  assert.equal(capabilities.credentialProfile, undefined);
  assert.equal(capabilities.credentialStorage.name, "new");
  assert.equal(JSON.stringify(capabilities).includes(saved.key), false);
  await client.request("/test");
  saved = { key: `mk-${"b".repeat(32)}`, name: "rotated" };
  await client.request("/test");
  assert.deepEqual(headers, [`Bearer mk-${"a".repeat(32)}`, `Bearer mk-${"b".repeat(32)}`]);
});

test("missing credentials reload and unsafe storage fails closed without leaking errors", () => {
  let saved = null;
  const client = new MetasoClient({
    environment: {}, credentialStore: { read: () => saved }, keychainLoader: () => ({ key: "" }),
  });
  assert.equal(client.capabilities().authenticated, false);
  saved = { key: `mk-${"a".repeat(32)}`, name: "connected" };
  assert.equal(client.capabilities().authenticated, true);
  const unsafe = new MetasoClient({
    environment: {},
    credentialStore: { read: () => { throw Object.assign(new Error(saved.key), { code: "UNSAFE_CREDENTIAL_STORAGE" }); } },
    keychainLoader: () => assert.fail("unsafe file storage must not trigger fallback"),
  });
  assert.equal(unsafe.capabilities().authenticated, false);
  assert.equal(JSON.stringify(unsafe.capabilities()).includes(saved.key), false);
  assert.throws(() => unsafe.requireApiKey(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE" && !error.message.includes(saved.key));
});

test("Reader sends format through the HTTP Accept header", async () => {
  const accepts = [];
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      accepts.push(options.headers.Accept);
      if (options.headers.Accept === "text/plain") {
        return response("# Page", { contentType: "text/plain" });
      }
      return response({ title: "Page", markdown: "# Page", credits: 3 });
    },
  });
  const json = await client.readUrl({ url: "https://example.com", format: "json" });
  const markdown = await client.readUrl({ url: "https://example.com", format: "markdown" });
  assert.deepEqual(accepts, ["application/json", "text/plain"]);
  assert.equal(json.credits, 3);
  assert.equal(markdown.markdown, "# Page");
});

test("Bookshelf URL import uses form encoding, not JSON", async () => {
  let captured;
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      captured = options;
      return response({ errCode: 0, errMsg: "success", data: { fileId: "file-1" } });
    },
  });
  const book = await client.uploadBook({ source_type: "url", url: "https://example.com/a b" });
  assert.equal(captured.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(captured.body, /^url=https%3A%2F%2Fexample\.com%2Fa(?:\+|%20)b$/);
  assert.equal(book.fileId, "file-1");
});

test("SSE parser accepts data with or without a space and detects DONE", () => {
  const events = parseSseText(
    'data:{"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata:[DONE]\n\n',
  );
  assert.equal(events.length, 3);
  assert.equal(events[0].choices[0].delta.content, "A");
  assert.equal(events[1].choices[0].delta.content, "B");
  assert.equal(events[2].type, "done");
});

test("Open API session IDs preserve integer precision in JSON and follow-up payloads", async () => {
  const exactSessionId = "2095344398104588317";
  const requests = [];
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response(
        `{"errCode":0,"data":{"sessionId":${exactSessionId},"text":"ok","references":[]}}`,
      );
    },
  });

  const first = await client.openSearch({ question: "first", stream: false });
  assert.equal(first.sessionId, exactSessionId);
  assert.equal(typeof first.sessionId, "string");

  await client.openSearch({ question: "follow-up", session_id: first.sessionId, stream: false });
  assert.equal(requests[1].sessionId, exactSessionId);
});

test("streaming Open API output preserves session IDs without returning duplicate raw events", async () => {
  const exactSessionId = "2095344450047635519";
  const body = [
    `data: {"type":"query","sessionId":${exactSessionId}}`,
    'data: {"type":"set-reference","list":[{"title":"Source","link":"https://example.com"},{"title":"Source","link":"https://example.com"}]}',
    'data: {"type":"append-text","text":"answer"}',
    'data: {"type":"answer-link-num-highlights","data":["same","same"]}',
    'data: {"type":"heartbeat"}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response(body, { contentType: "text/event-stream" }),
  });

  const result = await client.openSearch({ question: "stream", stream: true });
  assert.equal(result.sessionId, exactSessionId);
  assert.equal(result.text, "answer");
  assert.equal(result.eventCount, 6);
  assert.deepEqual(result.eventTypes, {
    query: 1,
    "set-reference": 1,
    "append-text": 1,
    "answer-link-num-highlights": 1,
    heartbeat: 1,
    done: 1,
  });
  assert.equal(result.references.length, 1);
  assert.deepEqual(result.highlights, ["same"]);
  assert.equal(Object.hasOwn(result, "events"), false);
});

test("streaming Open API output retains more than 50 unique references", async () => {
  const references = Array.from({ length: 60 }, (_, index) => ({
    title: `Source ${index + 1}`,
    link: `https://example.com/source-${index + 1}`,
  }));
  const body = [
    `data: ${JSON.stringify({ type: "set-reference", list: references })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response(body, { contentType: "text/event-stream" }),
  });

  const result = await client.openSearch({ question: "stream", stream: true });
  assert.equal(result.references.length, 60);
  assert.equal(result.references[59].link, "https://example.com/source-60");
});

test("non-stream answers remove exposed reasoning traces while preserving the final answer", async () => {
  const leaked = [
    ">用户询问测试问题。",
    ">分析搜索结果并检查约束。",
    ">[Final Check] 输出语言正确。",
    "",
    "Final answer [1].",
  ].join("\n");
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response({ answer: leaked, sources: [{ title: "Source" }] }),
  });

  const result = await client.answer({ question: "test", model: "fast" });
  assert.equal(result.answer, "Final answer [1].");
  assert.equal(result.reasoningTraceFiltered, true);
  assert.equal(result.sources[0].title, "Source");
});

test("English thinking-process wrappers and streamed traces are removed", async () => {
  const leaked = ">Here's a thinking process:\n>Let's analyze the evidence.\n\nFinal answer.";
  let upstreamBody;
  const forcedStreamBody = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: leaked } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  const nonStreamClient = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      upstreamBody = JSON.parse(options.body);
      return response(forcedStreamBody, { contentType: "text/event-stream" });
    },
  });
  const nonStream = await nonStreamClient.answer({ question: "test", model: "fast_thinking", format: "simple" });
  assert.equal(nonStream.answer, "Final answer.");
  assert.equal(nonStream.reasoningTraceFiltered, true);
  assert.equal(nonStream.streamedUpstream, true);
  assert.equal(upstreamBody.stream, true);

  const streamBody = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: leaked } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  const streamClient = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response(streamBody, { contentType: "text/event-stream" }),
  });
  const streamed = await streamClient.answer({ question: "test", model: "fast_thinking", stream: true });
  assert.equal(streamed.content, "Final answer.");
  assert.equal(streamed.reasoningTraceFiltered, true);
});

test("chat SSE deduplicates repeated citations and highlights", async () => {
  const citation = { title: "Source", link: "https://example.com/source" };
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Answer", citations: [citation, citation], highlights: ["same", "same"] } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response(body, { contentType: "text/event-stream" }),
  });
  const result = await client.answer({ question: "test", model: "fast", stream: true });
  assert.deepEqual(result.citations, [citation]);
  assert.deepEqual(result.highlights, ["same"]);
});

test("ordinary leading blockquotes are not removed from answers", async () => {
  const answer = "> A directly quoted source.\n\nExplanation.";
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response({ answer }),
  });
  const result = await client.answer({ question: "test", model: "fast" });
  assert.equal(result.answer, answer);
  assert.equal(result.reasoningTraceFiltered, undefined);
});

test("explicit reasoning fields are removed from non-stream responses", async () => {
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () =>
      response({
        answer: "Final answer.",
        reasoning_content: "private trace",
        choices: [
          { message: { role: "assistant", content: "Final answer.", reasoning: "private trace" } },
        ],
      }),
  });
  const result = await client.answer({ question: "test", model: "fast" });
  assert.equal(result.reasoning_content, undefined);
  assert.equal(result.choices[0].message.reasoning, undefined);
  assert.equal(result.reasoningTraceFiltered, true);
});

test("secret redaction removes bearer tokens and MetaSo keys", () => {
  const fakeMetaSoKey = `mk-${"x".repeat(32)}`;
  const output = redactSecrets(`Authorization: Bearer abc.def and ${fakeMetaSoKey}`);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes(fakeMetaSoKey), false);
});
