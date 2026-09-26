import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync as nativeSpawnSync } from "node:child_process";
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
  const nativeRuntime = process.platform === "win32" && process.env.METASO_TEST_POWERSHELL_PATH
    ? { powershellCandidates: [process.env.METASO_TEST_POWERSHELL_PATH] } : {};
  return { root, directory, store: new CredentialStore({ directory, ...nativeRuntime, ...options }) };
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
    try { new CredentialStore({directory:process.argv[1], ...(process.env.METASO_TEST_POWERSHELL_PATH ? {powershellCandidates:[process.env.METASO_TEST_POWERSHELL_PATH]} : {})}).write({key:${JSON.stringify(key)},name:process.argv[2]}); process.stdout.write('written'); }
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
  const priorModulePaths = Object.entries(process.env).filter(([name]) => /^PSModulePath$/i.test(name));
  for (const [name] of priorModulePaths) delete process.env[name];
  process.env.PSModulePath = "fixture-powershell-seven-modules";
  process.env.pSmOdUlEpAtH = "fixture-mixed-case-modules";
  t.after(() => {
    for (const name of Object.keys(process.env)) if (/^PSModulePath$/i.test(name)) delete process.env[name];
    for (const [name, value] of priorModulePaths) process.env[name] = value;
  });
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, kind: options.env?.METASO_ACL_FRESH_KIND });
    assert.equal(JSON.stringify(args).includes(key), false);
    if (command === "whoami.exe") return { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' };
    assert.equal(command, "powershell.exe");
    assert.equal(Object.keys(options.env).some((name) => /^PSModulePath$/i.test(name)), false);
    assert.equal(Object.keys(options.env).some((name) => /^METASO_API_KEY$/i.test(name)), false);
    if (!options.env.METASO_ACL_TARGETS) return { status: 0, stdout: "metaso-acl-runtime-v1" };
    assert.equal(options.env.METASO_ACL_SID, "S-1-5-21-111-222-333-1001");
    assert.ok(Array.isArray(JSON.parse(options.env.METASO_ACL_TARGETS)));
    if (options.env.METASO_ACL_FRESH_KIND) {
      assert.ok(args.includes("-EncodedCommand"));
      const target = options.env.METASO_ACL_TARGET;
      if (options.env.METASO_ACL_FRESH_KIND === "directory") assert.deepEqual(readdirSync(target), []);
      else assert.equal(readFileSync(target, "utf8"), "");
      return { status: 0, stdout: "applied" };
    }
    return { status: 0, stdout: "private\r\n" };
  };
  const { store } = fixture(t, { platform: "win32", spawnSync, powershellCandidates: ["powershell.exe"] });
  store.write({ key, name: "Windows fixture" });
  const beforeRead = calls.length;
  assert.equal(store.read().key, key);
  assert.equal(calls.slice(beforeRead).filter(({ command }) => command === "powershell.exe").length, 1);
  assert.deepEqual(calls.filter(({ kind }) => kind).map(({ kind }) => kind), ["directory", "file"]);
});

test("Windows never resets ACLs on a pre-existing directory", (t) => {
  const { directory } = fixture(t);
  mkdirSync(directory, { mode: 0o700 });
  const store = new CredentialStore({ directory, platform: "win32", powershellCandidates: ["powershell.exe"], spawnSync: (command, _args, options) => {
    if (command === "whoami.exe") return { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' };
    assert.equal(options.env.METASO_ACL_FRESH_KIND, undefined, "Existing directories must only be inspected.");
    if (!options.env.METASO_ACL_TARGETS) return { status: 0, stdout: "metaso-acl-runtime-v1" };
    return { status: 1 };
  } });
  assert.throws(() => store.ensureDirectory(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.deepEqual(readdirSync(directory), []);
});

test("Windows fails closed if private ACL enforcement is unavailable", (t) => {
  const { store } = fixture(t, {
    platform: "win32",
    powershellCandidates: ["powershell.exe"],
    spawnSync: (command, _args, options) => command === "whoami.exe"
      ? { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' }
      : !options.env.METASO_ACL_TARGETS ? { status: 0, stdout: "metaso-acl-runtime-v1" } : { status: 1 },
  });
  assert.throws(() => store.write({ key, name: "test" }), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.equal(existsSync(store.path), false);
});

test("Windows selects PowerShell 7 once and caches the successful probe", (t) => {
  const commands = [];
  const { store } = fixture(t, { platform: "win32", powershellCandidates: ["pwsh.exe", "powershell.exe"],
    spawnSync: (command, args, options) => {
      commands.push(command);
      assert.ok(args.includes("-EncodedCommand"));
      assert.equal(options.env.METASO_ACL_FRESH_KIND, undefined);
      assert.equal(options.env.METASO_API_KEY, undefined);
      return { status: 0, stdout: "metaso-acl-runtime-v1" };
    },
  });
  assert.equal(store.windowsPowerShell(), "pwsh.exe");
  assert.equal(store.windowsPowerShell(), "pwsh.exe");
  assert.deepEqual(commands, ["pwsh.exe"]);
});

for (const unavailable of ["missing", "empty output"]) {
  test(`Windows runtime selection falls back only after a ${unavailable} read-only probe`, (t) => {
    const commands = [];
    const { store } = fixture(t, { platform: "win32", powershellCandidates: ["pwsh.exe", "powershell.exe"],
      spawnSync: (command, _args, options) => {
        commands.push(command);
        assert.equal(options.env.METASO_ACL_FRESH_KIND, undefined);
        if (command === "pwsh.exe") return unavailable === "missing"
          ? { status: null, error: { code: "ENOENT" } } : { status: 0, stdout: "" };
        return { status: 0, stdout: "metaso-acl-runtime-v1" };
      },
    });
    assert.equal(store.windowsPowerShell(), "powershell.exe");
    assert.deepEqual(commands, ["pwsh.exe", "powershell.exe"]);
    assert.equal(existsSync(store.path), false);
  });
}

test("Windows refuses credential writes when no runtime passes the nonsecret probe", (t) => {
  const commands = [];
  const { store } = fixture(t, { platform: "win32", powershellCandidates: ["pwsh.exe", "powershell.exe"],
    spawnSync: (command, _args, options) => {
      if (command === "whoami.exe") return { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' };
      commands.push(command);
      assert.equal(options.env.METASO_ACL_FRESH_KIND, undefined, "No ACL mutation may run after failed probes.");
      return { status: 0, stdout: "" };
    },
  });
  assert.throws(() => store.write({ key, name: "No runtime" }), (error) => error.code === "CREDENTIAL_STORE_UNAVAILABLE");
  assert.deepEqual(commands, ["pwsh.exe", "powershell.exe"]);
  assert.equal(existsSync(store.path), false);
});

for (const stage of ["apply", "verify"]) {
  test(`Windows never switches runtime after an ACL ${stage} failure`, (t) => {
    const commands = [];
    const { store, directory } = fixture(t, { platform: "win32", powershellCandidates: ["pwsh.exe", "powershell.exe"],
      spawnSync: (command, _args, options) => {
        if (command === "whoami.exe") return { status: 0, stdout: '"user","S-1-5-21-111-222-333-1001"' };
        commands.push(command);
        if (!options.env.METASO_ACL_TARGETS) return { status: 0, stdout: "metaso-acl-runtime-v1" };
        return { status: 1 };
      },
    });
    if (stage === "verify") mkdirSync(directory, { mode: 0o700 });
    assert.throws(() => store.write({ key, name: "Failure" }), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
    assert.deepEqual(commands, ["pwsh.exe", "pwsh.exe"]);
    assert.equal(existsSync(store.path), false);
  });
}

test("native Windows rejects an additional Everyone-read ACE without replacing the credential", { skip: process.platform !== "win32" }, (t) => {
  const { store } = fixture(t);
  store.write({ key, name: "Windows ACL test" });
  const before = readFileSync(store.path);
  const result = nativeSpawnSync("icacls.exe", [store.path, "/grant", "*S-1-1-0:R"], {
    encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: "ignore",
  });
  assert.equal(result.status, 0, "The native ACL test must successfully grant Everyone read access before verifying rejection.");
  assert.throws(() => store.read(), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.throws(() => store.write({ key: nextKey, name: "Replacement", replace: true }), (error) => error.code === "UNSAFE_CREDENTIAL_STORAGE");
  assert.equal(readFileSync(store.path).equals(before), true, "Unsafe credentials must not be overwritten.");
});

test("native Windows removes explicit default ACEs only on fresh empty objects", { skip: process.platform !== "win32" }, (t) => {
  let injected = 0;
  const { store } = fixture(t, { spawnSync: (command, args, options) => {
    if (options.env?.METASO_ACL_FRESH_KIND) {
      const target = options.env.METASO_ACL_TARGET;
      if (options.env.METASO_ACL_FRESH_KIND === "directory") assert.deepEqual(readdirSync(target), []);
      else assert.equal(statSync(target).size, 0);
      const added = nativeSpawnSync("icacls.exe", [target, "/grant", "*S-1-1-0:R"], {
        encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: "ignore",
      });
      assert.equal(added.status, 0, "The native fixture must add an explicit default ACE before initialization.");
      injected++;
    }
    return nativeSpawnSync(command, args, options);
  } });
  store.write({ key, name: "Private defaults" });
  assert.equal(injected, 2);
  assert.equal(store.read().key === key, true);
});

test("native Windows creates a private empty directory with verifiable ACLs", { skip: process.platform !== "win32" }, (t) => {
  let verification;
  const safeCode = (value) => typeof value === "string" && /^[A-Za-z0-9_.,-]{1,240}$/.test(value) &&
    !/S-\d+(?:-\d+)+/.test(value) ? value : undefined;
  const transportMetadata = (result) => ({
    status: Number.isInteger(result.status) ? result.status : null,
    signal: safeCode(result.signal) ?? null,
    errorCode: safeCode(result.error?.code) ?? null,
  });
  const spawnSync = (command, args, options) => {
    const result = nativeSpawnSync(command, args, options);
    if (options.env?.METASO_ACL_TARGETS) verification = { command, result, options };
    return result;
  };
  const { store } = fixture(t, { spawnSync });
  let failure;
  try { store.ensureDirectory(); } catch (error) { failure = error; }
  if (!failure) {
    assert.equal(existsSync(store.path), false);
    return;
  }

  // This fixture never contains a Key. Keep diagnostic output limited to ACL
  // booleans/flags and sanitized error identifiers, not names, paths or SIDs.
  const script = [
    "$ErrorActionPreference='Stop'",
    "function Safe-Error($e) { $type=$e.Exception.GetType().FullName; $id=[string]$e.FullyQualifiedErrorId; if($type -notmatch '^[A-Za-z0-9_.]{1,160}$'){$type='unclassified'}; if($id -notmatch '^[A-Za-z0-9_.,-]{1,240}$' -or $id -match 'S-\\d+(?:-\\d+)+'){$id='unclassified'}; return @{errorType=$type; fullyQualifiedErrorId=$id} }",
    "try { $paths=ConvertFrom-Json -InputObject $env:METASO_ACL_TARGETS; $sid=[System.Security.Principal.SecurityIdentifier]::new($env:METASO_ACL_SID); $checks=@(foreach($p in $paths){try{$a=Get-Acl -LiteralPath $p; $rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); @{ownerMatches=($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value); protected=[bool]$a.AreAccessRulesProtected; ruleCount=$rules.Count; rules=@(foreach($r in $rules){@{isCurrentSid=($r.IdentityReference.Value -eq $sid.Value); isInherited=[bool]$r.IsInherited; isAllow=($r.AccessControlType -eq 'Allow'); rights=[int]$r.FileSystemRights; inheritanceFlags=[int]$r.InheritanceFlags; propagationFlags=[int]$r.PropagationFlags}})}}catch{Safe-Error $_}}); @{checks=$checks}|ConvertTo-Json -Compress -Depth 6 } catch { Safe-Error $_ | ConvertTo-Json -Compress }",
  ].join("; ");
  let inspection = { available: false };
  if (verification) {
    const result = nativeSpawnSync(verification.command, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
    ], { ...verification.options, stdio: ["ignore", "pipe", "ignore"] });
    inspection = { available: true, ...transportMetadata(result) };
    try {
      const parsed = JSON.parse(result.stdout);
      const errorFields = (value) => ({ errorType: safeCode(value?.errorType), fullyQualifiedErrorId: safeCode(value?.fullyQualifiedErrorId) });
      const ruleFields = (rule) => ({
        isCurrentSid: rule?.isCurrentSid === true, isInherited: rule?.isInherited === true, isAllow: rule?.isAllow === true,
        rights: Number.isInteger(rule?.rights) ? rule.rights : null,
        inheritanceFlags: Number.isInteger(rule?.inheritanceFlags) ? rule.inheritanceFlags : null,
        propagationFlags: Number.isInteger(rule?.propagationFlags) ? rule.propagationFlags : null,
      });
      inspection = {
        ...inspection, ...errorFields(parsed),
        checks: Array.isArray(parsed.checks) ? parsed.checks.map((check) => ({
          ...errorFields(check), ownerMatches: check.ownerMatches === true, protected: check.protected === true,
          ruleCount: Number.isInteger(check.ruleCount) ? check.ruleCount : null,
          rules: Array.isArray(check.rules) ? check.rules.map(ruleFields) : [],
        })) : [],
      };
    } catch { inspection.outputParsed = false; }
  }
  assert.fail(JSON.stringify({
    failureCode: safeCode(failure.code) ?? "UNKNOWN",
    verification: verification ? transportMetadata(verification.result) : null,
    inspection,
  }));
});
