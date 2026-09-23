import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CredentialStore } from "./credentials.mjs";
import { defaultKeyName, validateKeyName } from "./auth-contract.mjs";
import { WebApiProvisionError, provisionApiKey } from "./web-api-provision.mjs";

export const PLAYWRIGHT_VERSION = "1.63.0";
const TERMINAL = new Set(["idle", "complete", "failed", "cancelled"]);

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

// Browser/package-manager children do not need API keys or diagnostic logging.
function childEnvironment(environment) {
  const allowed = /^(PATH|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS)$/i;
  return Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.test(key)));
}

async function run(command, args, { environment, signal, timeout = 180_000 } = {}) {
  if (signal?.aborted) throw failure("CANCELLED", "Connection cancelled.");
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: childEnvironment(environment ?? process.env), stdio: "ignore", windowsHide: true,
    });
    let stopped;
    let killTimer;
    const stop = (code) => {
      stopped ??= code;
      child.kill();
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    const abort = () => stop("CANCELLED");
    const timer = setTimeout(() => stop("RUNTIME_TIMEOUT"), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", () => { cleanup(); reject(failure("RUNTIME_SETUP_FAILED", "Could not start the browser dependency installer. Install Node.js with npm, then retry.")); });
    // Keep the auth lock until the installer has actually exited on cancellation.
    child.once("close", code => {
      cleanup();
      if (stopped) return reject(failure(stopped, "Browser dependency setup stopped. Check the network or cancel state before retrying."));
      if (code === 0) resolve();
      else reject(failure("RUNTIME_SETUP_FAILED", "Browser dependency setup failed. Check npm/network access or use manual import."));
    });
  });
}

function npmCommand(environment) {
  if (process.platform !== "win32") return { command: "npm", prefix: [] };
  // Run npm's JavaScript entrypoint without cmd.exe or shell interpolation.
  for (const directory of [dirname(process.execPath), ...(environment.PATH ?? environment.Path ?? "").split(delimiter)]) {
    const candidate = join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(candidate)) return { command: process.execPath, prefix: [candidate] };
  }
  throw failure("NPM_UNAVAILABLE", "npm was not found. Install Node.js with npm or use manual import.");
}

export async function prepareBrowserRuntime({ store, environment = process.env, signal, onState }) {
  const root = join(store.ensureDirectory(), "browser-runtime", PLAYWRIGHT_VERSION);
  const entry = join(root, "node_modules", "playwright", "index.mjs");
  const validate = async () => {
    if (JSON.parse(readFileSync(join(root, "node_modules", "playwright", "package.json"), "utf8")).version !== PLAYWRIGHT_VERSION) throw failure("RUNTIME_VERSION", "Browser runtime version differs from the pinned version.");
    // Validate in a separate process so a failed ESM import cannot poison this
    // process's module cache before a bounded repair installation.
    await run(process.execPath, ["--input-type=module", "-e", "const m = await import(process.argv[1]); if (!m.chromium) process.exit(1);", pathToFileURL(entry).href], { environment, signal, timeout: 15_000 });
  };
  let valid = false;
  if (existsSync(entry)) { try { await validate(); valid = true; } catch { if (signal.aborted) throw failure("CANCELLED", "Connection cancelled."); } }
  if (!valid) {
    onState("installing_browser_support");
    // Preserve an interrupted/corrupt installation instead of trusting one file
    // or deleting an uncertain directory. Only one repair is attempted.
    if (existsSync(root)) renameSync(root, `${root}.incomplete-${randomUUID()}`);
    const npm = npmCommand(environment);
    await run(npm.command, [...npm.prefix, "install", "--prefix", root, "--no-audit", "--no-fund", "--ignore-scripts", "--package-lock=false", "--no-save", `playwright@${PLAYWRIGHT_VERSION}`], { environment, signal });
    await validate();
  }
  const { chromium } = await import(pathToFileURL(realpathSync(entry)).href);
  const launchOptions = { headless: false, env: childEnvironment(environment) };
  for (const channel of process.platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"]) {
    if (signal.aborted) throw failure("CANCELLED", "Connection cancelled.");
    try { return await chromium.launch({ ...launchOptions, channel }); } catch { /* Try another supported browser. */ }
  }
  if (signal.aborted) throw failure("CANCELLED", "Connection cancelled.");
  onState("installing_browser");
  await run(process.execPath, [join(root, "node_modules", "playwright", "cli.js"), "install", "chromium", "--no-shell"], { environment, signal });
  try { return await chromium.launch({ ...launchOptions, channel: "chromium" }); }
  catch { throw failure("BROWSER_UNAVAILABLE", "Cannot open a browser here. Run the connection command on a desktop with Chrome or Edge, or use manual import."); }
}

export class AuthManager {
  constructor(options = {}) {
    this.environment = options.environment ?? process.env;
    this.store = options.store ?? new CredentialStore({ environment: this.environment });
    this.prepare = options.prepare ?? prepareBrowserRuntime;
    this.provision = options.provision ?? provisionApiKey;
    this.session = { state: "idle" };
    this.browser = null;
    this.pending = null;
  }

  status() {
    let credential;
    try { credential = this.store.status(); }
    catch (error) { credential = { configured: false, path: this.store.path, error: /^[A-Z_]+$/.test(error.code ?? "") ? error.code : "CREDENTIAL_STORE_UNAVAILABLE" }; }
    return { ...this.session, credential, environmentOverridesFile: Boolean(this.environment.METASO_API_KEY), authentication: "local_browser_setup", nativeOAuth: false };
  }

  acquireLock() {
    const directory = this.store.ensureDirectory();
    this.lockPath = join(directory, ".browser-auth-lock");
    try { mkdirSync(this.lockPath, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw failure("AUTH_LOCK_FAILED", "Cannot reserve a connection session.");
      if (lstatSync(this.lockPath).isSymbolicLink()) throw failure("AUTH_LOCK_FAILED", "Connection lock must not be a symbolic link.");
      // Do not race another process to recover a stale lock. Never unlink a
      // lock based on an earlier PID read; another session may own it by then.
      let owner;
      try { owner = JSON.parse(readFileSync(join(this.lockPath, "owner.json"), "utf8")); }
      catch { throw failure("AUTH_BUSY", "Another connection is starting or its lock needs inspection. Close other MetaSo setup sessions first."); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw failure("AUTH_BUSY", "Connection lock needs inspection.");
      try { process.kill(owner.pid, 0); }
      catch (check) {
        if (check.code === "ESRCH") {
          throw failure("AUTH_STALE_LOCK", "A prior setup process stopped unexpectedly. Inspect and remove only the stale .browser-auth-lock directory before retrying.");
        }
      }
      throw failure("AUTH_BUSY", "Another MetaSo connection is in progress. Finish or cancel it first.");
    }
    this.lockOwner = JSON.stringify({ pid: process.pid, token: randomUUID() });
    try { writeFileSync(join(this.lockPath, "owner.json"), this.lockOwner, { flag: "wx", mode: 0o600 }); }
    catch { rmdirSync(this.lockPath); throw failure("AUTH_LOCK_FAILED", "Cannot reserve a connection session."); }
    this.ownsLock = true;
  }

  releaseLock() {
    if (!this.ownsLock) return;
    try {
      if (!lstatSync(this.lockPath).isSymbolicLink() && readFileSync(join(this.lockPath, "owner.json"), "utf8") === this.lockOwner) {
        unlinkSync(join(this.lockPath, "owner.json")); rmdirSync(this.lockPath);
      }
    } catch { /* Leave uncertain state for inspection. */ }
    this.ownsLock = false;
  }

  start({ name, mode = "create", replace = false, timeout_seconds = 600 } = {}) {
    if (this.pending) return this.status();
    if (mode === "import" && !name) throw failure("INVALID_KEY_NAME", "Choose an existing Key name to import.");
    name ??= defaultKeyName();
    name = validateKeyName(name);
    if (!["create", "import"].includes(mode)) throw failure("INVALID_MODE", "mode must be create or import.");
    if (!Number.isInteger(timeout_seconds) || timeout_seconds < 30 || timeout_seconds > 900) throw failure("INVALID_TIMEOUT", "Connection timeout must be 30–900 seconds.");
    let configured;
    try { configured = this.store.status().configured; }
    catch (error) { if (!(replace && error.code === "INVALID_CREDENTIAL")) throw error; }
    if (configured && !replace) throw failure("CREDENTIAL_EXISTS", "A plugin credential is already stored. Use replace=true only when you intend to replace it.");
    this.acquireLock();
    this.controller = new AbortController();
    this.session = { state: "starting", name, mode, startedAt: new Date().toISOString(), message: "Complete login in the browser. The Key stays local and is never returned to chat." };
    const timer = setTimeout(() => this.controller.abort(), timeout_seconds * 1000);
    this.pending = this.connect({ name, mode, replace, timeoutMs: timeout_seconds * 1000 })
      .finally(() => { clearTimeout(timer); this.releaseLock(); this.pending = null; });
    return this.status();
  }

  async connect(options) {
    const signal = this.controller.signal;
    const onState = state => { if (!signal.aborted) this.session.state = state === "complete" ? "saving" : state; };
    try {
      this.browser = await this.prepare({ store: this.store, environment: this.environment, signal, onState });
      if (signal.aborted) throw failure("CANCELLED", "Connection cancelled.");
      const context = await this.browser.newContext({ acceptDownloads: false });
      const page = await context.newPage();
      // No persistent profile, storageState, tracing, video, HAR, screenshots or console forwarding.
      const credential = await this.provision(page, { ...options, onState, signal });
      if (signal.aborted) throw failure("CANCELLED", "Connection cancelled.");
      onState("saving");
      this.store.write({ ...credential, replace: options.replace });
      this.session = { ...this.session, state: "complete", message: "MetaSo Key saved locally. The MCP will load it on the next call.", completedAt: new Date().toISOString() };
    } catch (error) {
      // Never propagate a browser call log, page HTML, or credential through MCP.
      const code = signal.aborted ? "CANCELLED" : /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "AUTH_FAILED";
      this.session = { ...this.session, state: signal.aborted ? "cancelled" : "failed", code,
        ...(error instanceof WebApiProvisionError ? { stage: error.stage, mayHaveCreatedKey: error.mayHaveCreatedKey } : {}),
        message: signal.aborted ? "Connection cancelled or timed out. If creation had started, inspect the named Key before retrying."
          : "Connection did not complete. Inspect the named Key on MetaSo before retrying; use import mode to recover an already-created Key. No existing Key was regenerated or deleted." };
    } finally {
      await this.browser?.close().catch(() => {});
      this.browser = null;
    }
  }

  async cancel() {
    if (!TERMINAL.has(this.session.state)) {
      this.controller?.abort();
      await this.browser?.close().catch(() => {});
    }
    await this.pending;
    return this.status();
  }
}
