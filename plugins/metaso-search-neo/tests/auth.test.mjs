import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthManager } from "../mcp/auth.mjs";
import { CredentialStore } from "../mcp/credentials.mjs";
import { callTool } from "../mcp/tools.mjs";

const key = `mk-${"a".repeat(32)}`;
function fixture(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), "metaso-auth-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CredentialStore({ directory: join(directory, "private") });
  let closed = 0;
  const browser = { newContext: async () => ({ newPage: async () => ({}) }), close: async () => { closed++; } };
  const auth = new AuthManager({ store, environment: {}, prepare: async () => browser, provision: async () => ({ key, name: "Auth test" }), ...extra });
  return { auth, store, closed: () => closed };
}

test("browser setup writes a private credential and only exposes metadata", async t => {
  const { auth, store, closed } = fixture(t);
  const initial = auth.start({ name: "Auth test" });
  assert.equal(initial.credential.configured, false);
  await auth.pending;
  assert.equal(auth.status().state, "complete");
  assert.equal(store.read().key, key);
  assert.equal(closed(), 1);
  assert.ok(!JSON.stringify(auth.status()).includes(key));
  assert.throws(() => auth.start({ name: "Another" }), { code: "CREDENTIAL_EXISTS" });
});

test("an uncertain submission never exposes browser call logs or replaces credentials", async t => {
  const { auth, store } = fixture(t, { provision: async () => { throw Object.assign(new Error(`DOM ${key}`), { code: "SUBMISSION_UNCERTAIN" }); } });
  auth.start({ name: "Uncertain" });
  await auth.pending;
  assert.equal(auth.status().code, "SUBMISSION_UNCERTAIN");
  assert.equal(store.status().configured, false);
  assert.ok(!JSON.stringify(auth.status()).includes(key));
});

test("duplicate starts are coalesced and another process manager cannot create a second Key", async t => {
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const { auth, store } = fixture(t, { provision: async () => { await deferred; return { key, name: "One" }; } });
  auth.start({ name: "One" });
  const other = new AuthManager({ store });
  assert.throws(() => other.start({ name: "Two" }), { code: "AUTH_BUSY" });
  assert.equal(auth.start({ name: "Ignored" }).name, "One");
  release();
  await auth.pending;
});

test("cancellation closes the browser, releases the lock and prevents saving", async t => {
  const { auth, store } = fixture(t, { provision: async (_page, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true })) });
  auth.start({ name: "Cancel" });
  await new Promise(resolve => setImmediate(resolve));
  await auth.cancel();
  assert.equal(auth.status().state, "cancelled");
  assert.equal(store.status().configured, false);
});

test("authentication tools need no API Key and reject secret fields", async t => {
  const { auth } = fixture(t);
  const context = { auth, client: {}, settings: {} };
  assert.equal((await callTool("metaso_auth_status", {}, context)).structuredContent.nativeOAuth, false);
  const invalid = await callTool("metaso_auth_start", { api_key: key }, context);
  assert.equal(invalid.isError, true);
  assert.ok(!JSON.stringify(invalid).includes(key));
  const noName = await callTool("metaso_auth_start", { mode: "import" }, context);
  assert.equal(noName.isError, true);
});

test("explicit replacement repairs malformed private credentials without returning their contents", async t => {
  const { auth, store } = fixture(t);
  store.write({ key, name: "Before repair" });
  writeFileSync(store.path, "{broken");
  assert.equal(auth.status().credential.error, "INVALID_CREDENTIAL");
  assert.throws(() => auth.start({ name: "Repair" }), { code: "INVALID_CREDENTIAL" });
  auth.start({ name: "Repair", replace: true });
  await auth.pending;
  assert.equal(auth.status().state, "complete");
  assert.equal(store.read().key, key);
});

test("stale locks are left for inspection instead of racing another recovery", t => {
  const { auth, store } = fixture(t);
  const lock = join(store.ensureDirectory(), ".browser-auth-lock");
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 2147483647, token: "old" }));
  assert.throws(() => auth.start({ name: "Stale" }), { code: "AUTH_STALE_LOCK" });
});
