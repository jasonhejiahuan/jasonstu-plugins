import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  LEGACY_METASO_KEYCHAIN_SERVICE,
  METASO_KEYCHAIN_SERVICE,
  loadMetaSoCredentialFromKeychain,
} from "../mcp/metaso-keychain.mjs";

const pluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const importer = join(pluginRoot, "scripts", "import-metaso-key.command");

function fakeKeyPath(keychain, service, account) {
  return join(keychain, `${service}--${account}.key`);
}

function fakeNotePath(keychain, service, account) {
  return join(keychain, `${service}--${account}.note`);
}

async function createFakeTools(directory) {
  const toolsDirectory = join(directory, "fake tools");
  await mkdir(toolsDirectory);
  const security = join(toolsDirectory, "security");
  const launchctl = join(toolsDirectory, "launchctl");
  await writeFile(
    security,
    `#!/bin/sh
set -eu
command="$1"
shift
account=""
comment=""
service=""
show_password=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -a) account="$2"; shift 2 ;;
    -j) comment="$2"; shift 2 ;;
    -s) service="$2"; shift 2 ;;
    -l|-T) shift 2 ;;
    -U) shift ;;
    -w) show_password=1; shift ;;
    *) shift ;;
  esac
done
key_file="$METASO_TEST_KEYCHAIN/$service--$account.key"
note_file="$METASO_TEST_KEYCHAIN/$service--$account.note"
case "$command" in
  add-generic-password)
    IFS= read -r first
    IFS= read -r second
    [ "$first" = "$second" ]
    printf '%s' "$first" > "$key_file"
    printf '%s' "$comment" > "$note_file"
    ;;
  find-generic-password)
    [ -f "$key_file" ] || exit 44
    [ "$show_password" -eq 0 ] || cat "$key_file"
    ;;
  delete-generic-password)
    [ "\${METASO_TEST_DELETE_FAILURE_ACCOUNT:-}" != "$account" ] || exit 77
    [ -f "$key_file" ] || exit 44
    rm -f "$key_file" "$note_file"
    ;;
  *) exit 64 ;;
esac
`,
  );
  await writeFile(
    launchctl,
    `#!/bin/sh
set -eu
[ "$1" = "unsetenv" ]
printf 'cleared' > "$METASO_TEST_LAUNCHCTL_STATE"
`,
  );
  await chmod(security, 0o700);
  await chmod(launchctl, 0o700);
  return { security, launchctl };
}

function runImporter(
  args,
  { input, tools, keychain, profileDirectory, launchctlState, deleteFailureAccount = "" },
) {
  return spawnSync("/bin/zsh", [importer, ...args], {
    encoding: "utf8",
    input,
    env: {
      PATH: process.env.PATH,
      METASO_SECURITY_BIN: tools.security,
      METASO_LAUNCHCTL_BIN: tools.launchctl,
      METASO_TEST_KEYCHAIN: keychain,
      METASO_TEST_LAUNCHCTL_STATE: launchctlState,
      METASO_TEST_DELETE_FAILURE_ACCOUNT: deleteFailureAccount,
      METASO_KEY_PROFILE_DIR: profileDirectory,
    },
  });
}

test("named Key importer validates, annotates, switches, reports, and clears without echoing Keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metaso-key-import-"));
  const keychain = join(directory, "keychain");
  const profileDirectory = join(directory, "profile metadata");
  const launchctlState = join(directory, "launchctl-state");
  await mkdir(keychain);
  const tools = await createFakeTools(directory);
  const workKey = `mk-${"A1".repeat(16)}`;
  const personalKey = `mk-${"B2".repeat(16)}`;
  const options = { tools, keychain, profileDirectory, launchctlState };

  try {
    const invalid = runImporter([], { ...options, input: "bad name\nnote\n" });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /Invalid Key name/);
    await assert.rejects(stat(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "bad name")), {
      code: "ENOENT",
    });

    const invalidNote = runImporter([], {
      ...options,
      input: "unsafe-note\nterminal\u001b[31mcontrol\n",
    });
    assert.equal(invalidNote.status, 2);
    assert.match(invalidNote.stderr, /Invalid note/);
    await assert.rejects(
      stat(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "unsafe-note")),
      { code: "ENOENT" },
    );

    const invalidKey = runImporter([], {
      ...options,
      input: "invalid-key\nRejected format\nnot-a-key\nnot-a-key\n",
    });
    assert.equal(invalidKey.status, 2);
    assert.match(invalidKey.stderr, /Invalid MetaSo API Key format/);
    await assert.rejects(
      stat(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "invalid-key")),
      { code: "ENOENT" },
    );

    const work = runImporter([], {
      ...options,
      input: `work\nProduction account\n${workKey}\n${workKey}\n`,
    });
    assert.equal(work.status, 0, work.stderr);
    assert.match(work.stdout, /Saved and selected 'work'/);
    assert.equal(work.stdout.includes(workKey), false);
    assert.equal(work.stderr.includes(workKey), false);
    assert.equal(
      await readFile(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "work"), "utf8"),
      workKey,
    );
    assert.equal(
      await readFile(fakeNotePath(keychain, METASO_KEYCHAIN_SERVICE, "work"), "utf8"),
      "Production account",
    );
    assert.equal(await readFile(join(profileDirectory, "active-profile"), "utf8"), "work\n");
    assert.equal(await readFile(launchctlState, "utf8"), "cleared");

    const refusedUpdate = runImporter([], {
      ...options,
      input: "work\nMistyped replacement\nnot-a-key\nnot-a-key\n",
    });
    assert.equal(refusedUpdate.status, 1);
    assert.match(refusedUpdate.stderr, /avoid destructive overwrites/);
    assert.equal(
      await readFile(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "work"), "utf8"),
      workKey,
    );

    const personal = runImporter([], {
      ...options,
      input: `personal\n个人测试额度\n${personalKey}\n${personalKey}\n`,
    });
    assert.equal(personal.status, 0, personal.stderr);
    assert.equal(await readFile(join(profileDirectory, "active-profile"), "utf8"), "personal\n");

    const listed = runImporter(["--list"], options);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /  work — Production account/);
    assert.match(listed.stdout, /\* personal — 个人测试额度/);
    assert.equal(listed.stdout.includes(workKey), false);
    assert.equal(listed.stdout.includes(personalKey), false);

    const switched = runImporter(["--use", "work"], options);
    assert.equal(switched.status, 0, switched.stderr);
    const status = runImporter(["--status"], options);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Selected 'work'/);

    const loaded = loadMetaSoCredentialFromKeychain({
      platform: "darwin",
      securityBin: tools.security,
      profileDirectory,
      environment: { METASO_TEST_KEYCHAIN: keychain },
    });
    assert.deepEqual(loaded, { key: workKey, profile: "work" });

    const failedClear = runImporter(["--clear", "work"], {
      ...options,
      deleteFailureAccount: "work",
    });
    assert.equal(failedClear.status, 1);
    assert.match(failedClear.stderr, /selection metadata was retained/);
    assert.equal(await readFile(join(profileDirectory, "active-profile"), "utf8"), "work\n");
    assert.match(await readFile(join(profileDirectory, "profiles.tsv"), "utf8"), /^work\t/m);
    assert.equal(
      await readFile(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "work"), "utf8"),
      workKey,
    );

    const cleared = runImporter(["--clear", "work"], options);
    assert.equal(cleared.status, 0, cleared.stderr);
    await assert.rejects(stat(fakeKeyPath(keychain, METASO_KEYCHAIN_SERVICE, "work")), {
      code: "ENOENT",
    });
    await assert.rejects(stat(join(profileDirectory, "active-profile")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selected legacy-service profiles remain readable and clearing does not activate an unnamed legacy account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metaso-key-migration-"));
  const keychain = join(directory, "keychain");
  const profileDirectory = join(directory, "profiles");
  const launchctlState = join(directory, "launchctl-state");
  await mkdir(keychain);
  await mkdir(profileDirectory);
  const tools = await createFakeTools(directory);
  const legacyKey = `mk-${"C3".repeat(16)}`;
  const unnamedKey = `mk-${"D4".repeat(16)}`;
  const options = { tools, keychain, profileDirectory, launchctlState };

  try {
    await writeFile(
      fakeKeyPath(keychain, LEGACY_METASO_KEYCHAIN_SERVICE, "legacy-profile"),
      legacyKey,
    );
    await writeFile(
      fakeKeyPath(keychain, LEGACY_METASO_KEYCHAIN_SERVICE, "METASO_API_KEY"),
      unnamedKey,
    );
    await writeFile(join(profileDirectory, "active-profile"), "legacy-profile\n");
    await writeFile(join(profileDirectory, "profiles.tsv"), "legacy-profile\tImported earlier\n");

    assert.deepEqual(
      loadMetaSoCredentialFromKeychain({
        platform: "darwin",
        securityBin: tools.security,
        profileDirectory,
        environment: { METASO_TEST_KEYCHAIN: keychain },
      }),
      { key: legacyKey, profile: "legacy-profile" },
    );

    const cleared = runImporter(["--clear", "legacy-profile"], options);
    assert.equal(cleared.status, 0, cleared.stderr);
    await assert.rejects(
      stat(fakeKeyPath(keychain, LEGACY_METASO_KEYCHAIN_SERVICE, "legacy-profile")),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(
        fakeKeyPath(keychain, LEGACY_METASO_KEYCHAIN_SERVICE, "METASO_API_KEY"),
        "utf8",
      ),
      unnamedKey,
    );
    assert.deepEqual(
      loadMetaSoCredentialFromKeychain({
        platform: "darwin",
        securityBin: tools.security,
        profileDirectory,
        environment: { METASO_TEST_KEYCHAIN: keychain },
      }),
      { key: "", profile: "" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("relative credential metadata overrides are rejected consistently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "metaso-key-relative-"));
  const keychain = join(directory, "keychain");
  const launchctlState = join(directory, "launchctl-state");
  await mkdir(keychain);
  const tools = await createFakeTools(directory);
  try {
    const result = runImporter(["--status"], {
      tools,
      keychain,
      profileDirectory: "relative-profile-directory",
      launchctlState,
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /absolute path/);
    assert.deepEqual(
      loadMetaSoCredentialFromKeychain({
        platform: "darwin",
        securityBin: tools.security,
        profileDirectory: "relative-profile-directory",
        environment: { METASO_TEST_KEYCHAIN: keychain },
      }),
      { key: "", profile: "" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Keychain loader stays disabled off macOS", () => {
  assert.deepEqual(loadMetaSoCredentialFromKeychain({ platform: "linux" }), {
    key: "",
    profile: "",
  });
});
