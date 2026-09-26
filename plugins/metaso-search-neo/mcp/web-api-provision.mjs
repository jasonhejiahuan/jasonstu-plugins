import { METASO_API_KEYS_URL, validateKeyName } from "./auth-contract.mjs";

const ORIGIN = "https://metaso.cn";
const LIST_PATH = "/api/get_api_keys";
const CREATE_PATH = "/api/edit_api_key";
const POLL_INTERVAL_MS = 2_000;
const QUIET_LOGIN_POLL_MS = 15_000;
const AUTH_ATTEMPTS_PER_ACTIVITY = 3;
const KEY_PATTERN = /^mk-[A-Za-z0-9]{16,253}$/;
const MESSAGES = {
  INVALID_OPTIONS: "Invalid browser connection options.",
  INVALID_KEY_NAME: "Use an API Key name of 1–20 UTF-16 code units without control characters or API Keys.",
  DUPLICATE_KEY_NAME: "The API Key name is not unique. Choose another name or import an existing uniquely named Key.",
  KEY_NOT_FOUND: "No API Key with the exact requested name exists in this account.",
  API_SCHEMA_CHANGED: "MetaSo's web API returned an unexpected structure. No additional creation request will be sent.",
  API_REJECTED: "MetaSo rejected the web API request. Check the account before trying again.",
  AUTH_EXPIRED: "The MetaSo browser login expired. Inspect the named Key before reconnecting.",
  RATE_LIMITED: "MetaSo limited this request. Wait before reconnecting.",
  SERVER_UNAVAILABLE: "The MetaSo web service is unavailable. Try again later.",
  PAGE_UNAVAILABLE: "The MetaSo browser session could not complete the request.",
  CANCELLED: "Browser connection was cancelled. Inspect the named Key if creation had started.",
  BROWSER_CLOSED: "The connection browser was closed. Inspect the named Key if creation had started.",
  TIMEOUT: "Browser connection timed out while waiting for MetaSo login.",
  SUBMISSION_UNCERTAIN: "API Key creation may have completed. Inspect the MetaSo list and import the same name; do not create it again automatically.",
};

export class WebApiProvisionError extends Error {
  constructor(code, stage = "validation", mayHaveCreatedKey = false) {
    super(MESSAGES[code] ?? MESSAGES.PAGE_UNAVAILABLE);
    this.name = "WebApiProvisionError";
    this.code = code;
    this.stage = stage;
    this.mayHaveCreatedKey = mayHaveCreatedKey;
  }
}

function onMetaSo(page) {
  try { return new URL(page.url()).origin === ORIGIN; } catch { return false; }
}

function onKeyPage(page) {
  try {
    const url = new URL(page.url());
    return url.origin === ORIGIN && /^\/search-api\/api-keys\/?$/.test(url.pathname);
  } catch { return false; }
}

/**
 * Use the first-party web API observed in MetaSo's own current public JavaScript.
 * This is an undocumented website contract, not MetaSo OAuth or a public REST
 * key-management API. Login happens in the caller's temporary browser context.
 * Never inspect DOM, cookies, storageState, full headers, or unrelated API data.
 */
export async function provisionApiKey(page, options = {}) {
  let name;
  try { name = validateKeyName(options.name); }
  catch { throw new WebApiProvisionError("INVALID_KEY_NAME"); }
  const { timeoutMs = 600_000, mode = "create", signal, onState = () => {} } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000 ||
    !["create", "import"].includes(mode) || typeof onState !== "function") {
    throw new WebApiProvisionError("INVALID_OPTIONS");
  }

  let token = "";
  let activity = 0;
  let finished = false;
  let submitted = false;
  let stage = "opening";
  let lastState;
  let stopped;
  let rejectStopped;
  const deadline = Date.now() + timeoutMs;
  const stoppedPromise = new Promise((_, reject) => { rejectStopped = reject; });
  stoppedPromise.catch(() => {});
  const failure = (code) => new WebApiProvisionError(code, stage, submitted);
  const stop = (code) => {
    if (stopped) return;
    stopped = failure(code);
    rejectStopped(stopped);
  };
  const aborted = () => stop("CANCELLED");
  const closed = () => stop("BROWSER_CLOSED");
  const ensureActive = () => {
    if (stopped) throw stopped;
    if (signal?.aborted) throw failure("CANCELLED");
    if (page.isClosed()) throw failure("BROWSER_CLOSED");
    if (Date.now() >= deadline) throw failure(submitted ? "SUBMISSION_UNCERTAIN" : "TIMEOUT");
  };
  const operation = async (callback) => {
    ensureActive();
    return Promise.race([Promise.resolve().then(() => { ensureActive(); return callback(); }), stoppedPromise]);
  };
  const pause = (duration = 100) => operation(() => new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(duration, deadline - Date.now())))));
  const emit = (state) => {
    if (lastState === state) return;
    lastState = state;
    onState(state);
  };

  const observeRequest = async (request) => {
    try {
      const url = new URL(request.url());
      if (finished || url.origin !== ORIGIN || !url.pathname.startsWith("/api/")) return;
      // Read only this explicitly observed website auth header. Browser-managed
      // session cookies never leave the browser; no other headers are inspected.
      const value = await request.headerValue("token");
      if (finished) return;
      if (typeof value === "string" && value.trim() && value.length <= 8_192 && value !== token) {
        token = value;
        activity += 1;
      } else if (url.pathname !== LIST_PATH && url.pathname !== CREATE_PATH) {
        // Helper requests do not manufacture new activity and keep polling alive.
        activity += 1;
      }
    } catch { /* Request teardown never exposes browser or header diagnostics. */ }
  };

  const navigate = () => operation(() => page.goto(METASO_API_KEYS_URL, {
    waitUntil: "domcontentloaded", timeout: Math.max(1, Math.min(20_000, deadline - Date.now())),
  }));

  const requestApi = async (method) => {
    ensureActive();
    if (!onMetaSo(page)) return { kind: "not_on_origin" };
    if (!token) return { kind: "auth" };
    try {
      return await operation(() => page.evaluate(async ({ method, token, name, timeout }) => {
        if (globalThis.location.origin !== "https://metaso.cn") return { kind: "not_on_origin" };
        if (method !== "GET" && method !== "POST") return { kind: "schema" };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(method === "GET" ? "https://metaso.cn/api/get_api_keys" : "https://metaso.cn/api/edit_api_key", {
            method,
            credentials: "include",
            redirect: "error",
            signal: controller.signal,
            headers: { token, "metaso-pc": "pc", Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
            ...(method === "POST" ? { body: JSON.stringify({ action: "create", name }) } : {}),
          });
          if (response.status === 401 || response.status === 403) return { kind: "auth" };
          if (response.status === 429) return { kind: "limited" };
          if (response.status >= 500) return { kind: "server" };
          if (!response.ok) return { kind: "rejected" };
          let json;
          try { json = await response.json(); } catch { return { kind: "schema" }; }
          if (json?.errCode === 401 || json?.errCode === "401" || json?.errCode === 403 || json?.errCode === "403") return { kind: "auth" };
          if (json?.errCode !== 0 && json?.errCode !== "0") return { kind: "rejected" };
          if (method === "POST") {
            const record = json?.data;
            if (record?.name !== name || typeof record?.sensitiveId !== "string" ||
              !/^mk-[A-Za-z0-9]{16,253}$/.test(record.sensitiveId)) return { kind: "schema" };
            return { kind: "success", record: { name: record.name, key: record.sensitiveId } };
          }
          const rows = json?.data?.apiKeys;
          if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.name !== "string")) return { kind: "schema" };
          // Only the exact requested row's Key crosses the browser boundary.
          // Unrelated Key values and API response messages stay out of Node.
          const matches = rows.filter((row) => row.name === name);
          if (matches.length > 1) return { kind: "duplicate" };
          if (!matches.length) return { kind: "success", record: null };
          if (typeof matches[0].sensitiveId !== "string" || !/^mk-[A-Za-z0-9]{16,253}$/.test(matches[0].sensitiveId)) return { kind: "schema" };
          return { kind: "success", record: { name: matches[0].name, key: matches[0].sensitiveId } };
        } catch { return { kind: "network" }; }
        finally { clearTimeout(timer); }
      }, { method, token, name, timeout: Math.max(1, Math.min(10_000, deadline - Date.now())) }));
    } catch (error) {
      if (error instanceof WebApiProvisionError) throw error;
      ensureActive();
      return { kind: "network" };
    }
  };

  const rejectResponse = (response) => {
    const codes = { duplicate: "DUPLICATE_KEY_NAME", schema: "API_SCHEMA_CHANGED", auth: "AUTH_EXPIRED", limited: "RATE_LIMITED", server: "SERVER_UNAVAILABLE", rejected: "API_REJECTED" };
    throw failure(codes[response?.kind] ?? "PAGE_UNAVAILABLE");
  };

  const waitForLogin = async () => {
    stage = "waiting_for_login";
    emit("waiting_for_login");
    let attemptedActivity = -1;
    let attempts = 0;
    let nextPoll = 0;
    while (true) {
      ensureActive();
      if (activity !== attemptedActivity) {
        attemptedActivity = activity;
        attempts = 0;
        nextPoll = 0;
      }
      if (!token || !onMetaSo(page) || Date.now() < nextPoll) {
        await pause();
        continue;
      }
      attempts += 1;
      // A slow read-only fallback also detects cookie-only login completion
      // when the website retains its token and emits no other /api activity.
      nextPoll = Date.now() + (attempts >= AUTH_ATTEMPTS_PER_ACTIVITY ? QUIET_LOGIN_POLL_MS : POLL_INTERVAL_MS);
      const response = await requestApi("GET");
      if (response.kind === "success") return response;
      if (response.kind === "auth" || response.kind === "not_on_origin") continue;
      if (response.kind === "network" && attempts < AUTH_ATTEMPTS_PER_ACTIVITY) continue;
      rejectResponse(response);
    }
  };

  page.on("request", observeRequest);
  page.on("close", closed);
  signal?.addEventListener("abort", aborted, { once: true });
  const timer = setTimeout(() => stop(submitted ? "SUBMISSION_UNCERTAIN" : "TIMEOUT"), timeoutMs);
  try {
    ensureActive();
    emit("opening");
    await navigate();
    let list = await waitForLogin();
    // Navigation is only a user-facing return to the account page; no element,
    // form, selector, table, or DOM value is read anywhere in this workflow.
    if (!onKeyPage(page)) {
      stage = "returning_to_keys";
      await navigate();
      list = await waitForLogin();
    }
    stage = "checking_existing_names";
    emit("ready");
    if (mode === "import") {
      if (!list.record) throw failure("KEY_NOT_FOUND");
      emit("complete");
      return list.record;
    }
    if (list.record) throw failure("DUPLICATE_KEY_NAME");

    stage = "submitting";
    emit("creating");
    ensureActive();
    if (!onMetaSo(page) || !token) throw failure("PAGE_UNAVAILABLE");
    // Exactly one POST is allowed. Every subsequent attempt is a read-only GET,
    // including recovery from a dropped or structurally changed POST response.
    submitted = true;
    const created = await requestApi("POST");
    if (!["success", "schema", "network"].includes(created.kind)) rejectResponse(created);
    stage = "verifying_key";
    emit("waiting_for_key");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await pause(POLL_INTERVAL_MS);
      const confirmed = await requestApi("GET");
      if (confirmed.kind === "success" && confirmed.record) {
        if (confirmed.record.name !== name || !KEY_PATTERN.test(confirmed.record.key) ||
          (created.record && created.record.key !== confirmed.record.key)) throw failure("SUBMISSION_UNCERTAIN");
        emit("complete");
        return confirmed.record;
      }
      if (!["success", "network", "not_on_origin"].includes(confirmed.kind)) rejectResponse(confirmed);
    }
    throw failure("SUBMISSION_UNCERTAIN");
  } catch (error) {
    if (error instanceof WebApiProvisionError) throw error;
    if (signal?.aborted) throw failure("CANCELLED");
    if (page.isClosed()) throw failure("BROWSER_CLOSED");
    // Never attach raw browser exceptions, response JSON, tokens, or Key values.
    throw failure(submitted ? "SUBMISSION_UNCERTAIN" : "PAGE_UNAVAILABLE");
  } finally {
    finished = true;
    token = "";
    clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    page.off("request", observeRequest);
    page.off("close", closed);
  }
}
