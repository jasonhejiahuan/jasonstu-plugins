import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { ACCOUNT_URL, collectAccountMetadata, profileFromRows } from "../mcp/account-profile.mjs";
import { CredentialStore } from "../mcp/credentials.mjs";

const rows = [
  { label: "用户名", value: "示例用户" }, { label: "手机号码", value: "130****0000" },
  { label: "电子邮箱", value: "example@example.com" }, { label: "账号类型", value: "Pro版" },
  { label: "登录密码", value: "DO_NOT_READ" },
];
const metadata = { account: { ...profileFromRows(rows), source: ACCOUNT_URL, capturedAt: new Date().toISOString() }, accountProfileStatus: "available", quotaScope: "account" };

test("profile extraction allowlists labels, rejects secrets and conflicting duplicates", () => {
  assert.deepEqual(profileFromRows(rows), { username: "示例用户", phone: "130****0000", email: "example@example.com", accountType: "Pro版" });
  assert.deepEqual(profileFromRows([{ label: "用户名", value: `mk-${"a".repeat(32)}` }]), {});
  assert.throws(() => profileFromRows([...rows, { label: "用户名", value: "另一个用户" }]));
});

test("metadata survives storage, status omits Key, legacy files and replacement remain supported", t => {
  const root = mkdtempSync(join(tmpdir(), "metaso-profile-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new CredentialStore({ directory: join(root, "private") });
  const key = `mk-${"a".repeat(32)}`;
  store.write({ key, name: "Profile", metadata });
  assert.deepEqual(store.read().metadata, metadata);
  assert.deepEqual(store.status().metadata, metadata);
  assert.ok(!JSON.stringify(store.status()).includes(key));
  assert.throws(() => store.write({ key, name: "Bad", metadata: { ...metadata, password: "unexpected" }, replace: true }), { code: "INVALID_CREDENTIAL" });
  assert.throws(() => store.write({ key, name: "Bad", metadata: { ...metadata, account: { ...metadata.account, accountId: "invented" } }, replace: true }), { code: "INVALID_CREDENTIAL" });
  store.write({ key, name: "Legacy", replace: true });
  assert.equal(store.read().metadata, undefined);
});

test("headless failures are optional and browser is closed", async () => {
  let closed = 0;
  const result = await collectAccountMetadata({ context: { storageState: async () => ({}) }, prepare: async () => ({ newContext: async () => { throw new Error("private response"); }, close: async () => { closed++; } }), signal: new AbortController().signal });
  assert.deepEqual(result, { accountProfileStatus: "unavailable", quotaScope: "account" });
  assert.equal(closed, 1);
});

test("headless page reads rendered labels with in-memory session transfer", { skip: !process.env.METASO_TEST_PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = await import(pathToFileURL(process.env.METASO_TEST_PLAYWRIGHT_MODULE).href);
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  await context.addCookies([{ name: "fixture", value: "session", domain: "metaso.cn", path: "/", secure: true }]);
  try {
    const result = await collectAccountMetadata({ context, signal: new AbortController().signal, prepare: async () => {
      const child = await chromium.launch({ headless: true, channel: "chrome" });
      const original = child.newContext.bind(child);
      child.newContext = async options => {
        assert.equal(options.storageState.cookies[0].value, "session");
        const cloned = await original(options);
        await cloned.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: rows.map(r => `<div class="user-info_user-info-container-item-info__newHash"><div class="user-info_user-info-label__newHash">${r.label}</div><div class="user-info_user-info-value__newHash">${r.value}</div></div>`).join("") }));
        return cloned;
      };
      return child;
    } });
    assert.equal(result.accountProfileStatus, "available");
    assert.equal(result.account.username, "示例用户");
    assert.equal(result.account.phone, "130****0000");
    assert.ok(!JSON.stringify(result).includes("DO_NOT_READ"));
  } finally { await browser.close(); }
});
