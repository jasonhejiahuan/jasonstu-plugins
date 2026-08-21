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

test("search normalizes paper to scholar and preserves structured response", async () => {
  let captured;
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({ credits: 3, scholars: [{ title: "Paper" }], total: 1 });
    },
  });
  const result = await client.search({ query: "test", scope: "paper", size: 1 });
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
    client.search({ query: "test", size: 1, page: 1 }),
    (error) => error instanceof MetasoError && error.code === "MUTUALLY_EXCLUSIVE",
  );
});

test("HTTP 200 business errors are rejected", async () => {
  const client = new MetasoClient({
    apiKey: "test-key",
    fetchImpl: async () => response({ errCode: 2005, errMsg: "API密钥无效" }),
  });
  await assert.rejects(
    client.search({ query: "test" }),
    (error) => error instanceof MetasoError && error.code === 2005 && error.channel === "business",
  );
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

test("secret redaction removes bearer tokens and MetaSo keys", () => {
  const fakeMetaSoKey = `mk-${"x".repeat(32)}`;
  const output = redactSecrets(`Authorization: Bearer abc.def and ${fakeMetaSoKey}`);
  assert.equal(output.includes("abc.def"), false);
  assert.equal(output.includes(fakeMetaSoKey), false);
});
