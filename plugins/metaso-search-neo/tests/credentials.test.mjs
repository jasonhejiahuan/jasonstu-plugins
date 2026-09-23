import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore } from "../mcp/credentials.mjs";

const key = `mk-${"a".repeat(32)}`;
const nextKey = `mk-${"b".repeat(32)}`;

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "metaso-credentials-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "private");
  return { root, directory, store: new CredentialStore({ directory, ...options }) };
}

test("credential storage paths have explicit, stable precedence", (t) => {
  const { root } = fixture(t);
  const specified = join(root, "specific");
  assert.equal(new CredentialStore({ environment: { METASO_CREDENTIALS_DIR: specified, PLUGIN_DATA: root } }).directory, specified);
  assert.equal(new CredentialStore({ environment: { PLUGIN_DATA: root, CODEX_HOME: root } }).directory, join(root, "credentials"));
  assert.equal(new CredentialStore({ environment: { CODEX_HOME: root } }).directory, join(root, "state", "metaso-search-neo", "credentials"));
  for (const name of ["METASO_CREDENTIALS_DIR", "PLUGIN_DATA", "CODEX_HOME"]) {
    assert.throws(() => new CredentialStore({ environment: { [name]: "relative" } }), (error) => error.code === "INVALID_DIRECTORY");
  }
});

test("writes private credentials while returning only nonsecret metadata", (t) => {
  const { store } = fixture(t);
  assert.equal(store.read(), null);
  assert.equal(store.status().configured, false);
  const status = store.write({ key, name: "Codex test" });
  assert.equal(status.configured, true);
  assert.equal(status.storage, "file");
  assert.equal(status.encrypted, false);
  assert.equal(JSON.stringify(status).includes(key), false);
  assert.equal(store.read().key, key);
  assert.equal(store.read().name, "Codex test");
  if (process.platform !== "win32") {
    assert.equal(statSync(store.directory).mode & 0o777, 0o700);
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
  }
  assert.deepEqual(readdirSync(store.directory), ["credential.json"]);
});

test("duplicate credentials require explicit replacement and preserve the old file", (t) => {
  const { store } = fixture(t);
  store.write({ key, name: "first" });
  const original = readFileSync(store.path, "utf8");
  assert.throws(() => store.write({ key: nextKey, name: "second" }), (error) => error.code === "CREDENTIAL_EXISTS");
  assert.equal(readFileSync(store.path, "utf8"), original);
  store.write({ key: nextKey, name: "second", replace: true });
  assert.equal(store.read().key, nextKey);
  assert.equal(store.read().name, "second");
  assert.deepEqual(readdirSync(store.directory), ["credential.json"]);
});

test("an active write lock fails without modifying the credential", (t) => {
  const { store } = fixture(t);
  store.write({ key, name: "first" });
  mkdirSync(join(store.directory, ".write-lock"), { mode: 0o700 });
  assert.throws(() => store.write({ key: nextKey, name: "second", replace: true }), (error) => error.code === "CREDENTIAL_STORE_BUSY");
  assert.equal(store.read().key, key);
});

test("concurrent first writes produce one complete credential without clobbering", async (t) => {
  const { directory, store } = fixture(t);
  store.ensureDirectory();
  const moduleUrl = new URL("../mcp/credentials.mjs", import.meta.url).href;
  const code = `import { CredentialStore } from ${JSON.stringify(moduleUrl)};
    try { new CredentialStore({directory:process.argv[1]}).write({key:${JSON.stringify(key)},name:process.argv[2]}); process.stdout.write('written'); }
    catch(e) { process.stdout.write(e.code); }`;
  const run = (name) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, directory, name], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error("Fixture process failed")));
  });
  const outcomes = await Promise.all([run("one"), run("two")]);
  assert.equal(outcomes.filter((outcome) => outcome === "written").length, 1);
  assert.ok(outcomes.some((outcome) => ["CREDENTIAL_STORE_BUSY", "CREDENTIAL_EXISTS"].includes(outcome)));
  assert.ok(["one", "two"].includes(store.read().name));
  assert.deepEqual(readdirSync(directory), ["credential.json"]);
});

test("unsafe POSIX permissions are rejected rather than silently widened or accepted", { skip: process.platform === "win32" }, (t) => {
  const { store } = fixture(t);
  store.write({ key, name: "test" });
  chmodSync(store.path, 0o644);
  assert.throws(() => store.read(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.throws(() => store.write({ key: nextKey, name: "replacement", replace: true }), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  chmodSync(store.path, 0o600);
  chmodSync(store.directory, 0o755);
  assert.throws(() => store.ensureDirectory(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.throws(() => store.status(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
});

test("credential files and directories cannot be symbolic links or multiply linked files", { skip: process.platform === "win32" }, (t) => {
  const { root, directory, store } = fixture(t);
  const actual = join(root, "actual");
  mkdirSync(actual, { mode: 0o700 });
  symlinkSync(actual, directory);
  assert.throws(() => store.ensureDirectory(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  const nestedStore = new CredentialStore({ directory: join(directory, "nested") });
  mkdirSync(join(actual, "nested"), { mode: 0o700 });
  assert.throws(() => nestedStore.ensureDirectory(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.throws(() => nestedStore.read(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  rmSync(directory);
  store.ensureDirectory();
  const target = join(root, "target");
  writeFileSync(target, "untouched", { mode: 0o600 });
  symlinkSync(target, store.path);
  assert.throws(() => store.read(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.throws(() => store.write({ key, name: "test", replace: true }), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.equal(readFileSync(target, "utf8"), "untouched");
  rmSync(store.path);
  store.write({ key, name: "test" });
  linkSync(store.path, join(root, "extra-link"));
  assert.throws(() => store.read(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
});

test("invalid or corrupted credential content is never included in an error", (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.write({ key: "not-a-key", name: "test" }), (error) => error.code === "INVALID_CREDENTIAL" && !error.message.includes("not-a-key"));
  for (const name of [key, `named ${key}`, "x".repeat(21), "😀".repeat(11), "name\u202e", "name\u2028break"]) {
    assert.throws(() => store.write({ key, name }), (error) => error.code === "INVALID_CREDENTIAL" && !error.message.includes(key));
  }
  store.write({ key, name: "有效名称😀" });
  assert.equal(store.read().name, "有效名称😀");
  writeFileSync(store.path, `${key} invalid json`);
  assert.throws(() => store.read(), (error) => error.code === "INVALID_CREDENTIAL" && !error.message.includes(key));
});

test("credential names accept the website's 20 UTF-16-unit boundary", (t) => {
  const { store } = fixture(t);
  store.write({ key, name: "x".repeat(20) });
  assert.equal(store.read().name, "x".repeat(20));
  store.write({ key, name: "😀".repeat(10), replace: true });
  assert.equal(store.read().name, "😀".repeat(10));
});

test("Windows applies SID-restricted ACLs before writing any credential bytes", (t) => {
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args });
    assert.equal(JSON.stringify(args).includes(key), false);
    if (command === "whoami.exe") return { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' };
    if (command === "icacls.exe") {
      if (args.includes("/setowner")) {
        assert.equal(args[2], "*S-1-5-21-111-222-333-1001");
        return { status: 0 };
      }
      assert.equal(args.includes("/inheritance:r"), true);
      assert.ok(args.some((argument) => argument.startsWith("*S-1-5-21-111-222-333-1001:")));
      if (args[0].endsWith(".tmp")) assert.equal(readFileSync(args[0], "utf8"), "");
      return { status: 0 };
    }
    assert.equal(command, "powershell.exe");
    assert.equal(options.env.METASO_ACL_SID, "S-1-5-21-111-222-333-1001");
    assert.ok(Array.isArray(JSON.parse(options.env.METASO_ACL_TARGETS)));
    return { status: 0, stdout: "private\r\n" };
  };
  const { store } = fixture(t, { platform: "win32", spawnSync });
  store.write({ key, name: "Windows fixture" });
  const beforeRead = calls.length;
  assert.equal(store.read().key, key);
  assert.equal(calls.slice(beforeRead).filter(({ command }) => command === "powershell.exe").length, 1);
  assert.ok(calls.some(({ command }) => command === "icacls.exe"));
  assert.ok(calls.some(({ args }) => args.includes("/setowner")));
});

test("Windows fails closed if private ACL enforcement is unavailable", (t) => {
  const { store } = fixture(t, {
    platform: "win32",
    spawnSync: (command) => command === "whoami.exe"
      ? { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' }
      : { status: 1 },
  });
  assert.throws(() => store.write({ key, name: "test" }), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.equal(existsSync(store.path), false);
});
