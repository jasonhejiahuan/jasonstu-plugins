import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { METASO_API_KEYS_URL, validateKeyName, defaultKeyName } from "../mcp/auth-contract.mjs";
import { WebApiProvisionError, provisionApiKey } from "../mcp/web-api-provision.mjs";

const KEY_A = `mk-${"A".repeat(32)}`;
const KEY_B = `mk-${"B".repeat(32)}`;
const KEY_CREATED = `mk-${"C".repeat(32)}`;
const TOKEN = "fixture-browser-session-token";
const driver = process.env.METASO_TEST_PLAYWRIGHT_MODULE;
let browser;

before(async () => {
  if (!driver) return;
  const { chromium } = await import(pathToFileURL(driver).href);
  browser = await chromium.launch({ headless: true, ...(process.env.METASO_TEST_CHROME_EXECUTABLE
    ? { executablePath: process.env.METASO_TEST_CHROME_EXECUTABLE } : { channel: "chrome" }) });
});
after(async () => { await browser?.close(); });

function browserTest(name, callback) {
  return test(name, { skip: !driver && "Set METASO_TEST_PLAYWRIGHT_MODULE for isolated browser tests." }, callback);
}

async function fixture(t, options = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const state = {
    loggedIn: !options.requireLogin,
    rows: [...(options.rows ?? [])],
    listRequests: 0,
    createRequests: [],
    externalRequests: [],
    navigationPaths: [],
  };
  await page.exposeFunction("completeFixtureLogin", () => { state.loggedIn = true; });
  const html = `<!doctype html><html><body><script>
    const emitToken = () => fetch('/api/session_probe', {headers: {token: ${JSON.stringify(TOKEN)}}});
    window.fixtureLogin = async () => { await window.completeFixtureLogin(); ${options.quietLogin ? "" : "await emitToken();"} };
    ${options.noToken ? "" : "void emitToken();"}
  </script></body></html>`;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://metaso.cn") {
      state.externalRequests.push(url.origin);
      await route.abort();
      return;
    }
    if (url.pathname === "/api/session_probe") {
      await route.fulfill({ json: { errCode: state.loggedIn ? 0 : 401 } });
      return;
    }
    if (url.pathname === "/api/get_api_keys") {
      state.listRequests += 1;
      assert.equal(request.method(), "GET");
      assert.equal(await request.headerValue("token"), TOKEN);
      assert.equal(await request.headerValue("metaso-pc"), "pc");
      if (options.redirectList) {
        await route.fulfill({ status: 302, headers: { location: "https://external-fixture.invalid/steal" } });
      } else if (options.listStatus) {
        await route.fulfill({ status: options.listStatus, json: { errCode: 999, errMsg: TOKEN } });
      } else if (!state.loggedIn) {
        await route.fulfill({ json: { errCode: "401", errMsg: TOKEN } });
      } else if (options.listBody) {
        await route.fulfill({ json: options.listBody });
      } else {
        await route.fulfill({ json: { errCode: 0, data: { apiKeys: state.rows } } });
      }
      return;
    }
    if (url.pathname === "/api/edit_api_key") {
      assert.equal(request.method(), "POST");
      assert.equal(await request.headerValue("token"), TOKEN);
      assert.equal(await request.headerValue("metaso-pc"), "pc");
      const body = request.postDataJSON();
      state.createRequests.push(body);
      assert.deepEqual(Object.keys(body).sort(), ["action", "name"]);
      assert.equal(body.action, "create");
      assert.ok(body.name.length <= 20);
      const created = { name: body.name, sensitiveId: KEY_CREATED, createdAt: "2026-09-23T00:00:00Z" };
      if (!options.noCommit) state.rows.push(created);
      if (options.onPost) options.onPost(page);
      if (options.dropPostResponse) await route.abort();
      else if (options.malformedPost) await route.fulfill({ json: { errCode: 0, data: { changed: true } } });
      else await route.fulfill({ json: { errCode: "0", data: { ...created, ...(options.mismatchedPostKey ? { sensitiveId: KEY_B } : {}) } } });
      return;
    }
    state.navigationPaths.push(url.pathname);
    if (url.pathname === "/search-api/api-keys" && !state.loggedIn) {
      await route.fulfill({ contentType: "text/html", body: '<script>location.replace("https://metaso.cn/")</script>' });
    } else {
      await route.fulfill({ contentType: "text/html", body: html });
    }
  });
  t.after(async () => {
    try { assert.deepEqual(state.externalRequests, []); }
    finally { await context.close(); }
  });
  // This workflow must work with a page that has no form/table whatsoever.
  // Any regression to DOM selection fails immediately rather than silently
  // acquiring a fixture element or revealing a sensitive page value.
  const guardedPage = new Proxy(page, {
    get(target, property) {
      if (["locator", "getByRole", "getByTestId", "getByText", "getByPlaceholder", "content", "$", "$$", "$eval", "$$eval"].includes(property)) {
        return () => { throw new Error("DOM access is not allowed in the API provisioning workflow"); };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { page, guardedPage, state };
}

test("API key names use the verified 20-unit limit and generated names fit", () => {
  const first = defaultKeyName();
  assert.equal(first.length, 19);
  assert.equal(validateKeyName(first), first);
  assert.notEqual(first, defaultKeyName());
  assert.equal(validateKeyName(" Codex验证0923 "), "Codex验证0923");
  assert.equal(validateKeyName("😀".repeat(10)).length, 20);
  for (const name of ["", "x".repeat(21), "😀".repeat(11), KEY_A, "x\ny"]) {
    assert.throws(() => validateKeyName(name), { code: "INVALID_KEY_NAME" });
  }
});

browserTest("creates through the captured browser session API and confirms the exact named Key", async (t) => {
  const { guardedPage, state } = await fixture(t, { rows: [{ name: "Default", sensitiveId: KEY_A }] });
  const states = [];
  assert.deepEqual(await provisionApiKey(guardedPage, { name: "Codex验证0923", timeoutMs: 5_000, onState: (state) => states.push(state) }), { name: "Codex验证0923", key: KEY_CREATED });
  assert.deepEqual(state.createRequests, [{ action: "create", name: "Codex验证0923" }]);
  assert.equal(state.listRequests, 2);
  for (const value of [TOKEN, KEY_A, KEY_CREATED]) assert.equal(JSON.stringify(states).includes(value), false);
});

browserTest("manual login can finish on the homepage and returns to the API Keys page", async (t) => {
  const { page, guardedPage, state } = await fixture(t, { requireLogin: true });
  const setup = provisionApiKey(guardedPage, { name: "Login test", timeoutMs: 7_000 });
  await page.waitForURL("https://metaso.cn/");
  await page.evaluate(() => window.fixtureLogin());
  assert.deepEqual(await setup, { name: "Login test", key: KEY_CREATED });
  assert.equal(page.url(), METASO_API_KEYS_URL);
  assert.equal(state.navigationPaths.filter((path) => path === "/search-api/api-keys").length, 2);
});

browserTest("late cookie-only login resumes after bounded quiet polling without token changes", async (t) => {
  const { page, guardedPage, state } = await fixture(t, { requireLogin: true, quietLogin: true });
  const setup = provisionApiKey(guardedPage, { name: "Late login", timeoutMs: 25_000 });
  await page.waitForURL("https://metaso.cn/");
  while (state.listRequests < 3) await new Promise((resolve) => setTimeout(resolve, 100));
  await page.evaluate(() => window.fixtureLogin());
  assert.deepEqual(await setup, { name: "Late login", key: KEY_CREATED });
  assert.ok(state.listRequests <= 6);
  assert.equal(state.createRequests.length, 1);
});

browserTest("create rejects an existing exact name without a POST", async (t) => {
  const { guardedPage, state } = await fixture(t, { rows: [{ name: "Existing", sensitiveId: KEY_A }] });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Existing", timeoutMs: 5_000 }), { code: "DUPLICATE_KEY_NAME", mayHaveCreatedKey: false });
  assert.deepEqual(state.createRequests, []);
});

browserTest("import selects only the exact name and performs no mutation", async (t) => {
  const { guardedPage, state } = await fixture(t, { rows: [{ name: "Target extra", sensitiveId: KEY_A }, { name: "Target", sensitiveId: KEY_B }] });
  assert.deepEqual(await provisionApiKey(guardedPage, { name: "Target", mode: "import", timeoutMs: 5_000 }), { name: "Target", key: KEY_B });
  assert.deepEqual(state.createRequests, []);
});

browserTest("duplicate import rows reject every Key rather than guessing", async (t) => {
  const { guardedPage, state } = await fixture(t, { rows: [{ name: "Same", sensitiveId: KEY_A }, { name: "Same", sensitiveId: KEY_B }] });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Same", mode: "import", timeoutMs: 5_000 }), { code: "DUPLICATE_KEY_NAME", mayHaveCreatedKey: false });
  assert.deepEqual(state.createRequests, []);
});

browserTest("missing import name fails without creating or choosing another Key", async (t) => {
  const { guardedPage, state } = await fixture(t, { rows: [{ name: "Another", sensitiveId: KEY_A }] });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Missing", mode: "import", timeoutMs: 5_000 }), { code: "KEY_NOT_FOUND", mayHaveCreatedKey: false });
  assert.deepEqual(state.createRequests, []);
});

browserTest("a malformed create response can recover only through an exact read-only confirmation", async (t) => {
  const { guardedPage, state } = await fixture(t, { malformedPost: true });
  assert.deepEqual(await provisionApiKey(guardedPage, { name: "Malformed response", timeoutMs: 5_000 }), { name: "Malformed response", key: KEY_CREATED });
  assert.equal(state.createRequests.length, 1);
  assert.equal(state.listRequests, 2);
});

browserTest("a dropped POST response is recovered without a second POST", async (t) => {
  const { guardedPage, state } = await fixture(t, { dropPostResponse: true });
  assert.deepEqual(await provisionApiKey(guardedPage, { name: "Dropped response", timeoutMs: 5_000 }), { name: "Dropped response", key: KEY_CREATED });
  assert.equal(state.createRequests.length, 1);
});

browserTest("unconfirmed creation ends with an ambiguous result and never retries POST", async (t) => {
  const { guardedPage, state } = await fixture(t, { noCommit: true, malformedPost: true });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Unconfirmed", timeoutMs: 7_000 }), { code: "SUBMISSION_UNCERTAIN", mayHaveCreatedKey: true });
  assert.equal(state.createRequests.length, 1);
  assert.equal(state.listRequests, 4);
});

browserTest("creation and confirmation must agree on the Key value", async (t) => {
  const { guardedPage, state } = await fixture(t, { mismatchedPostKey: true });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Mismatch", timeoutMs: 5_000 }), { code: "SUBMISSION_UNCERTAIN", mayHaveCreatedKey: true });
  assert.equal(state.createRequests.length, 1);
});

browserTest("unknown business failures are sanitized and never polled repeatedly", async (t) => {
  const { guardedPage, state } = await fixture(t, { listBody: { errCode: 999, errMsg: `${TOKEN} ${KEY_A}` } });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Rejected", timeoutMs: 5_000 }), (error) => {
    assert.ok(error instanceof WebApiProvisionError);
    assert.equal(error.code, "API_REJECTED");
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes(TOKEN), false);
    assert.equal(JSON.stringify(error).includes(KEY_A), false);
    return true;
  });
  assert.equal(state.listRequests, 1);
  assert.deepEqual(state.createRequests, []);
});

browserTest("changed successful list schemas fail closed instead of creating", async (t) => {
  const { guardedPage, state } = await fixture(t, { listBody: { errCode: 0, data: { keys: [] } } });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Schema", timeoutMs: 5_000 }), { code: "API_SCHEMA_CHANGED", mayHaveCreatedKey: false });
  assert.equal(state.listRequests, 1);
  assert.deepEqual(state.createRequests, []);
});

browserTest("HTTP rate limits fail immediately without exposing response text", async (t) => {
  const { guardedPage, state } = await fixture(t, { listStatus: 429 });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Limited", timeoutMs: 5_000 }), { code: "RATE_LIMITED", mayHaveCreatedKey: false });
  assert.equal(state.listRequests, 1);
});

browserTest("fetch redirects cannot forward the captured browser token off-origin", async (t) => {
  const { guardedPage, state } = await fixture(t, { redirectList: true });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Redirect", timeoutMs: 7_000 }), { code: "PAGE_UNAVAILABLE", mayHaveCreatedKey: false });
  assert.equal(state.listRequests, 3);
  assert.deepEqual(state.externalRequests, []);
});

browserTest("cancelling before creation makes no POST", async (t) => {
  const { guardedPage, state } = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(provisionApiKey(guardedPage, { name: "Cancelled", timeoutMs: 5_000, signal: controller.signal, onState: (value) => { if (value === "creating") controller.abort(); } }), { code: "CANCELLED", mayHaveCreatedKey: false });
  assert.deepEqual(state.createRequests, []);
});

browserTest("cancelling after a POST never saves or retries its possible creation", async (t) => {
  const controller = new AbortController();
  const { guardedPage, state } = await fixture(t, { onPost: () => controller.abort() });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Cancel submitted", timeoutMs: 5_000, signal: controller.signal }), { code: "CANCELLED", mayHaveCreatedKey: true });
  assert.equal(state.createRequests.length, 1);
});

browserTest("a closed browser during login exits with a controlled error", async (t) => {
  const { page, guardedPage } = await fixture(t, { requireLogin: true, noToken: true });
  const setup = provisionApiKey(guardedPage, { name: "Closed", timeoutMs: 5_000 });
  const rejected = assert.rejects(setup, { code: "BROWSER_CLOSED", mayHaveCreatedKey: false });
  await page.waitForURL("https://metaso.cn/");
  await page.close();
  await rejected;
});

browserTest("login without a captured token times out without any key-management request", async (t) => {
  const { guardedPage, state } = await fixture(t, { requireLogin: true, noToken: true });
  await assert.rejects(provisionApiKey(guardedPage, { name: "Timed out", timeoutMs: 400 }), { code: "TIMEOUT", mayHaveCreatedKey: false });
  assert.equal(state.listRequests, 0);
  assert.deepEqual(state.createRequests, []);
});
