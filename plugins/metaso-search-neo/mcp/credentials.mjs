import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isLikelyMetaSoApiKey } from "./metaso-keychain.mjs";

export class CredentialStoreError extends Error {
  constructor(message, code = "CREDENTIAL_STORE_UNAVAILABLE") {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new CredentialStoreError(message, code);
}

function absoluteDirectory(value) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    fail("The credential directory must be an absolute path.", "INVALID_DIRECTORY");
  }
  return resolve(value);
}

function defaultDirectory(environment) {
  if (environment.METASO_CREDENTIALS_DIR) return absoluteDirectory(environment.METASO_CREDENTIALS_DIR);
  if (environment.PLUGIN_DATA) return join(absoluteDirectory(environment.PLUGIN_DATA), "credentials");
  const codexHome = environment.CODEX_HOME
    ? absoluteDirectory(environment.CODEX_HOME)
    : join(homedir(), ".codex");
  return join(codexHome, "state", "metaso-search-neo", "credentials");
}

function statIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail("The credential storage path cannot be inspected.");
  }
}

function validName(name) {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 20 &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name.trim()) && !/mk-[A-Za-z0-9]{16,}/.test(name);
}

function assertNoSymlinkPath(path) {
  let current = path;
  while (true) {
    const metadata = statIfPresent(current);
    // macOS exposes these root-owned system aliases even for ordinary tmpdir paths.
    const systemAlias = process.platform === "darwin" && metadata?.uid === 0 &&
      ["/var", "/tmp", "/etc"].includes(current) && current !== path;
    if (metadata?.isSymbolicLink() && !systemAlias) {
      fail("The credential storage path cannot traverse a symbolic link.", "UNSAFE_CREDENTIAL_STORAGE");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/** Plaintext credentials in a private, persistent directory outside the plugin bundle. */
export class CredentialStore {
  constructor(options = {}) {
    this.environment = options.environment ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.directory = options.directory === undefined
      ? defaultDirectory(this.environment)
      : absoluteDirectory(options.directory);
    this.path = join(this.directory, "credential.json");
    this.spawnSync = options.spawnSync ?? spawnSync;
    this.uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  }

  windowsSid() {
    if (this.sid) return this.sid;
    const result = this.spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8", windowsHide: true, timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const sid = String(result.stdout ?? "").match(/\bS-1-5-\d+(?:-\d+)+\b/)?.[0];
    if (result.error || result.status !== 0 || !sid) {
      fail("The current Windows account could not be identified for private credential storage.");
    }
    this.sid = sid;
    return sid;
  }

  verifyWindowsAcl(paths) {
    const sid = this.windowsSid();
    // A Node child of PowerShell 7 inherits incompatible PS7 module paths.
    // Let Windows PowerShell rebuild its own defaults; never relax the ACL check.
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PSMODULEPATH"));
    // Only metadata is returned. Neither the path nor a credential is interpolated into code.
    const script = "$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json -InputObject $env:METASO_ACL_TARGETS; " +
      "$s=[System.Security.Principal.SecurityIdentifier]::new($env:METASO_ACL_SID); " +
      "foreach($p in $paths){$a=Get-Acl -LiteralPath $p; " +
      "$ok=$a.AreAccessRulesProtected -and ($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $s.Value); " +
      "$rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); " +
      "if($rules.Count -eq 0){$ok=$false}; foreach($r in $rules){if($r.IdentityReference.Value -ne $s.Value -or $r.AccessControlType -ne 'Allow'){$ok=$false}}; " +
      "if(-not $ok){exit 1}}; Write-Output 'private'";
    const result = this.spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8", windowsHide: true, timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...environment, METASO_ACL_TARGETS: JSON.stringify(Array.isArray(paths) ? paths : [paths]), METASO_ACL_SID: sid },
    });
    if (result.error || result.status !== 0 || String(result.stdout ?? "").trim() !== "private") {
      fail("Credential storage must be owned by and accessible only to the current Windows account.", "UNSAFE_CREDENTIAL_STORAGE");
    }
  }

  applyWindowsAcl(path, directory) {
    const sid = this.windowsSid();
    // Elevated Windows sessions can create files owned by Administrators by default.
    const ownerResult = this.spawnSync("icacls.exe", [path, "/setowner", `*${sid}`], {
      encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: "ignore",
    });
    if (ownerResult.error || ownerResult.status !== 0) {
      fail("Current-user ownership could not be established for Windows credential storage.", "UNSAFE_CREDENTIAL_STORAGE");
    }
    const result = this.spawnSync("icacls.exe", [
      path, "/inheritance:r", "/grant:r", `*${sid}:${directory ? "(OI)(CI)" : ""}F`,
    ], { encoding: "utf8", windowsHide: true, timeout: 10_000, stdio: "ignore" });
    if (result.error || result.status !== 0) {
      fail("Private Windows credential permissions could not be applied.", "UNSAFE_CREDENTIAL_STORAGE");
    }
    this.verifyWindowsAcl(path);
  }

  assertPrivate(path, metadata, directory, checkWindowsAcl = true) {
    if (!metadata || metadata.isSymbolicLink() ||
      (directory ? !metadata.isDirectory() : !metadata.isFile() || metadata.nlink !== 1)) {
      fail("Credential storage cannot use links or an unexpected file type.", "UNSAFE_CREDENTIAL_STORAGE");
    }
    if (this.platform === "win32") {
      if (checkWindowsAcl) this.verifyWindowsAcl(path);
    } else if (metadata.uid !== this.uid || (metadata.mode & 0o077) !== 0) {
      fail("Credential storage must be owned by and accessible only to the current user.", "UNSAFE_CREDENTIAL_STORAGE");
    }
  }

  ensureDirectory() {
    assertNoSymlinkPath(this.directory);
    let metadata = statIfPresent(this.directory);
    if (metadata) {
      this.assertPrivate(this.directory, metadata, true);
      return this.directory;
    }
    const missing = [];
    let current = this.directory;
    while (!statIfPresent(current)) {
      missing.push(current);
      current = dirname(current);
    }
    const parent = statIfPresent(current);
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
      fail("The credential directory cannot be created through a symbolic link.", "UNSAFE_CREDENTIAL_STORAGE");
    }
    try {
      for (const path of missing.reverse()) {
        let created = false;
        try {
          mkdirSync(path, { mode: 0o700 });
          created = true;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        if (created && this.platform === "win32") this.applyWindowsAcl(path, true);
        this.assertPrivate(path, statIfPresent(path), true, !created);
      }
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      fail("The private credential directory could not be created.");
    }
    return this.directory;
  }

  read() {
    assertNoSymlinkPath(this.directory);
    const directory = statIfPresent(this.directory);
    if (!directory) return null;
    this.assertPrivate(this.directory, directory, true, false);
    const metadata = statIfPresent(this.path);
    if (!metadata) {
      if (this.platform === "win32") this.verifyWindowsAcl(this.directory);
      return null;
    }
    this.assertPrivate(this.path, metadata, false, false);
    let descriptor;
    try {
      descriptor = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = fstatSync(descriptor);
      this.assertPrivate(this.path, opened, false, false);
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size > 4096) {
        fail("The credential file changed while being opened or exceeds the permitted size.", "UNSAFE_CREDENTIAL_STORAGE");
      }
      if (this.platform === "win32") this.verifyWindowsAcl([this.directory, this.path]);
      const data = JSON.parse(readFileSync(descriptor, "utf8"));
      if (data?.version !== 1 || !isLikelyMetaSoApiKey(data.key) || !validName(data.name) ||
        typeof data.createdAt !== "string" || !Number.isFinite(Date.parse(data.createdAt))) {
        fail("The credential file is invalid. Run the MetaSo connection setup again.", "INVALID_CREDENTIAL");
      }
      return { key: data.key, name: data.name, createdAt: data.createdAt };
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      fail("The credential file could not be read. Run the MetaSo connection setup again.", "INVALID_CREDENTIAL");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  status() {
    const credential = this.read();
    return {
      configured: Boolean(credential),
      ...(credential ? { name: credential.name } : {}),
      path: this.path,
      storage: "file",
      encrypted: false,
    };
  }

  write({ key, name, replace = false } = {}) {
    if (!isLikelyMetaSoApiKey(key) || !validName(name) || typeof replace !== "boolean") {
      fail("A valid MetaSo API Key and a name of 1–20 characters without control characters or API Keys are required.", "INVALID_CREDENTIAL");
    }
    this.ensureDirectory();
    const lock = join(this.directory, ".write-lock");
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") fail("Another credential write is active or an interrupted write needs inspection. See docs/auth.md#interrupted-setup-and-writes before removing .write-lock.", "CREDENTIAL_STORE_BUSY");
      fail("The credential store could not be locked.");
    }
    const temporary = join(this.directory, `.credential-${randomBytes(16).toString("hex")}.tmp`);
    let descriptor;
    let temporaryCreated = false;
    try {
      const existing = statIfPresent(this.path);
      if (existing) {
        this.assertPrivate(this.path, existing, false);
        if (!replace) fail("A MetaSo credential already exists. Explicit replacement is required.", "CREDENTIAL_EXISTS");
      }
      descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      temporaryCreated = true;
      if (this.platform === "win32") this.applyWindowsAcl(temporary, false);
      this.assertPrivate(temporary, fstatSync(descriptor), false, false);
      const createdAt = new Date().toISOString();
      writeFileSync(descriptor, `${JSON.stringify({ version: 1, key, name: name.trim(), createdAt })}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (replace) {
        renameSync(temporary, this.path);
        temporaryCreated = false;
      } else {
        // Hard-link publication is atomic and cannot replace an existing destination.
        linkSync(temporary, this.path);
        unlinkSync(temporary);
        temporaryCreated = false;
      }
      if (this.platform !== "win32") {
        const directoryDescriptor = openSync(this.directory, constants.O_RDONLY);
        try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
      }
      return { configured: true, name: name.trim(), createdAt, path: this.path, storage: "file", encrypted: false };
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      if (error.code === "EEXIST") fail("A MetaSo credential already exists. Explicit replacement is required.", "CREDENTIAL_EXISTS");
      fail("The credential could not be stored privately.");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (temporaryCreated) {
        try { unlinkSync(temporary); } catch { /* A failed temporary write stays private. */ }
      }
      try { rmdirSync(lock); } catch { /* Never remove a lock recursively. */ }
    }
  }
}
