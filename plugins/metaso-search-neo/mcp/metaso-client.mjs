import { randomBytes } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { loadMetaSoCredentialFromKeychain } from "./metaso-keychain.mjs";
import { CredentialStore } from "./credentials.mjs";

const DEFAULT_BASE_URL = "https://metaso.cn";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SEARCH_SCOPES = new Set([
  "webpage",
  "document",
  "scholar",
  "image",
  "video",
  "podcast",
]);
const CHAT_MODELS = new Set(["fast", "fast_thinking", "ds-r1"]);

export class MetasoError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MetasoError";
    this.channel = options.channel ?? "business";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.retryable = Boolean(options.retryable);
    this.details = options.details;
  }

  toJSON() {
    return {
      channel: this.channel,
      code: this.code,
      httpStatus: this.httpStatus,
      message: redactSecrets(this.message),
      retryable: this.retryable,
      details: sanitizeDetails(this.details),
    };
  }
}

export function redactSecrets(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/mk-[A-Za-z0-9]{16,}/g, "mk-[REDACTED]");
}

function sanitizeDetails(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value)));
  } catch {
    return redactSecrets(value);
  }
}

function assertObject(value, name = "arguments") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetasoError(`${name} must be an object`, {
      channel: "validation",
      code: "INVALID_ARGUMENTS",
    });
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MetasoError(`${name} must be a non-empty string`, {
      channel: "validation",
      code: "INVALID_ARGUMENT",
    });
  }
  return value.trim();
}

function optionalInteger(value, name, minimum, maximum) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MetasoError(`${name} must be an integer from ${minimum} to ${maximum}`, {
      channel: "validation",
      code: "INVALID_ARGUMENT",
    });
  }
  return value;
}

function optionalBoolean(value, name, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new MetasoError(`${name} must be a boolean`, {
      channel: "validation",
      code: "INVALID_ARGUMENT",
    });
  }
  return value;
}

function normalizeScope(value, fallback = "webpage") {
  if (value === undefined || value === null || value === "") return fallback;
  const scope = String(value);
  if (!SEARCH_SCOPES.has(scope)) {
    throw new MetasoError(
      `scope must be one of ${[...SEARCH_SCOPES].join(", ")}`,
      { channel: "validation", code: "INVALID_SCOPE" },
    );
  }
  return scope;
}

function normalizeModel(value, fallback = "fast") {
  const model = value ?? fallback;
  if (!CHAT_MODELS.has(model)) {
    throw new MetasoError(`model must be one of ${[...CHAT_MODELS].join(", ")}`, {
      channel: "validation",
      code: "INVALID_MODEL",
    });
  }
  return model;
}

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("METASO_BASE_URL must use http or https");
  }
  return url.origin;
}

function detectBusinessError(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (Object.hasOwn(data, "errCode") && Number(data.errCode) !== 0) {
    return {
      code: data.errCode,
      message: data.errMsg || `MetaSo business error ${data.errCode}`,
    };
  }
  if (Object.hasOwn(data, "code") && Number(data.code) !== 0) {
    return {
      code: data.code,
      message: data.message || `MetaSo business error ${data.code}`,
    };
  }
  return null;
}

function mimeForPath(path) {
  const extension = extname(path).toLowerCase();
  return (
    {
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".html": "text/html",
      ".htm": "text/html",
      ".json": "application/json",
      ".csv": "text/csv",
    }[extension] || "application/octet-stream"
  );
}

function safeFilename(path) {
  return basename(path).replace(/["\r\n]/g, "_");
}

function createMultipartBody(fieldName, filePath, bytes) {
  const boundary = `----codex-metaso-${randomBytes(18).toString("hex")}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${safeFilename(filePath)}"\r\n` +
      `Content-Type: ${mimeForPath(filePath)}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([header, bytes, footer]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function preserveIdentifierIntegers(text) {
  return String(text).replace(
    /("(?:id|[A-Za-z_$][A-Za-z0-9_$]*(?:Id|ID|_id))"\s*:\s*)(-?\d+)(?=\s*[,}\]])/g,
    (_match, prefix, digits) => `${prefix}${JSON.stringify(digits)}`,
  );
}

function parseJsonMaybe(text) {
  if (!text) return null;
  try {
    return JSON.parse(preserveIdentifierIntegers(text));
  } catch {
    return null;
  }
}

function stripExposedReasoningTrace(text) {
  const original = String(text ?? "");
  const withoutTags = original.replace(
    /^\s*<(?:think|analysis)>[\s\S]*?<\/(?:think|analysis)>\s*/i,
    "",
  );
  const lines = withoutTags.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim());
  if (firstContent === -1 || !lines[firstContent].trimStart().startsWith(">")) {
    return { text: withoutTags, filtered: withoutTags !== original };
  }

  let boundary = firstContent;
  const quoted = [];
  while (boundary < lines.length) {
    const trimmed = lines[boundary].trimStart();
    if (trimmed && !trimmed.startsWith(">")) break;
    quoted.push(lines[boundary]);
    boundary += 1;
  }
  const trace = quoted.join("\n");
  const looksLikeReasoning =
    /(?:分析搜索结果|根据规则|检查约束|草拟回答|开始生成|思考结束|用户询问|输出语言|thinking process|let(?:'s| us) (?:analyze|reason)|we need to answer|analysis of (?:the )?search|draft answer|final check|instruction check)/i.test(
      trace,
    );
  const remainder = lines.slice(boundary).join("\n").trim();
  if (!looksLikeReasoning || !remainder) {
    return { text: withoutTags, filtered: withoutTags !== original };
  }
  return { text: remainder, filtered: true };
}

function sanitizeAnswerResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  let filtered = false;
  const result = { ...value };
  for (const field of ["reasoning", "reasoning_content", "thinking", "analysis"]) {
    if (!Object.hasOwn(result, field)) continue;
    delete result[field];
    filtered = true;
  }
  for (const field of ["answer", "content"]) {
    if (typeof result[field] !== "string") continue;
    const sanitized = stripExposedReasoningTrace(result[field]);
    result[field] = sanitized.text;
    filtered ||= sanitized.filtered;
  }
  if (Array.isArray(result.choices)) {
    result.choices = result.choices.map((choice) => {
      if (!choice?.message || typeof choice.message !== "object") return choice;
      const message = { ...choice.message };
      for (const field of ["reasoning", "reasoning_content", "thinking", "analysis"]) {
        if (!Object.hasOwn(message, field)) continue;
        delete message[field];
        filtered = true;
      }
      const content = message.content;
      if (typeof content !== "string") return { ...choice, message };
      const sanitized = stripExposedReasoningTrace(content);
      filtered ||= sanitized.filtered;
      return {
        ...choice,
        message: { ...message, content: sanitized.text },
      };
    });
  }
  return filtered ? { ...result, reasoningTraceFiltered: true } : result;
}

export function parseSseText(text) {
  const events = [];
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (!dataLines.length) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      events.push({ type: "done" });
      continue;
    }
    const parsed = parseJsonMaybe(data);
    events.push(parsed ?? { type: "raw", data });
  }
  return events;
}

function compactUnique(items, identity) {
  const seen = new Set();
  const result = [];
  for (const item of items ?? []) {
    const key = identity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function citationIdentity(item) {
  return item && typeof item === "object"
    ? item.link ?? item.url ?? item.id ?? `${item.title ?? ""}:${JSON.stringify(item)}`
    : String(item);
}

function aggregateChatSse(events) {
  const result = {
    content: "",
    citations: [],
    highlights: [],
    usage: {},
    model: undefined,
    finishReason: undefined,
  };
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const error = detectBusinessError(event) ?? (event.error ? { code: event.error.code, message: event.error.message ?? String(event.error) } : null);
    if (error) throw new MetasoError(error.message, { channel: "business", code: error.code });
    if (event.credits !== undefined) result.usage.credits = event.credits;
    if (Array.isArray(event.citations)) result.citations.push(...event.citations);
    if (event.model) result.model = event.model;
    if (event.usage && typeof event.usage === "object") {
      result.usage = { ...result.usage, ...event.usage };
    }
    for (const choice of event.choices ?? []) {
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") result.content += delta.content;
      if (Array.isArray(delta.citations)) result.citations.push(...delta.citations);
      if (Array.isArray(delta.highlights)) result.highlights.push(...delta.highlights);
      if (choice.finish_reason) result.finishReason = choice.finish_reason;
    }
  }
  result.citations = compactUnique(result.citations, citationIdentity);
  result.highlights = compactUnique(
    result.highlights,
    (item) => (typeof item === "string" ? item : JSON.stringify(item)),
  );
  return result;
}

function aggregateOpenSse(events) {
  const result = {
    text: "",
    references: [],
    highlights: [],
    sessionId: undefined,
    resultId: undefined,
    balance: undefined,
    eventCount: events.length,
    eventTypes: {},
  };
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    result.eventTypes[eventType] = (result.eventTypes[eventType] ?? 0) + 1;
    if (event.sessionId) result.sessionId = event.sessionId;
    if (event.resultId) result.resultId = event.resultId;
    switch (event.type) {
      case "balance":
        result.balance = event.data;
        break;
      case "query":
        result.sessionId = event.sessionId ?? event.data?.sessionId ?? result.sessionId;
        break;
      case "set-reference":
        result.references = event.list ?? event.data?.list ?? [];
        result.resultId = event.resultId ?? event.data?.resultId ?? result.resultId;
        break;
      case "append-text":
        result.text += event.text ?? event.data?.text ?? "";
        break;
      case "answer-link-num-highlights":
        result.highlights = event.data ?? event.list ?? [];
        break;
      default:
        break;
    }
  }
  result.references = compactUnique(result.references, citationIdentity);
  result.highlights = compactUnique(
    result.highlights,
    (item) => (typeof item === "string" ? item : JSON.stringify(item)),
  );
  return result;
}

function publicUrlAllowed(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^::ffff:(?:0*:)*127\./.test(host) ||
    host === "metadata.google.internal" ||
    host === "metadata.azure.internal"
  ) return false;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return false;
    }
  }
  return true;
}

export class MetasoClient {
  constructor(options = {}) {
    const environment = options.environment ?? process.env;
    this.environment = environment;
    this.dynamicCredentials = !Object.hasOwn(options, "apiKey") && !environment.METASO_API_KEY;
    this.keychainLoader = options.keychainLoader ?? loadMetaSoCredentialFromKeychain;
    this.credentialStore = options.credentialStore;
    if (Object.hasOwn(options, "apiKey")) {
      this.apiKey = options.apiKey ?? "";
      this.credentialSource = this.apiKey ? "explicit" : "none";
    } else if (environment.METASO_API_KEY) {
      this.apiKey = environment.METASO_API_KEY;
      this.credentialSource = "environment";
    } else {
      this.refreshCredentials();
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? environment.METASO_BASE_URL ?? DEFAULT_BASE_URL);
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs ?? environment.METASO_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.maxUploadBytes = Number(
      options.maxUploadBytes ?? environment.METASO_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES,
    );
    this.allowPrivateUrls =
      options.allowPrivateUrls ?? environment.METASO_ALLOW_PRIVATE_URLS === "true";
    if (typeof this.fetch !== "function") throw new Error("A Fetch API implementation is required");
  }

  refreshCredentials() {
    if (!this.dynamicCredentials) return;
    this.apiKey = "";
    this.credentialSource = "none";
    this.credentialProfile = "";
    this.credentialStorage = undefined;
    this.credentialError = undefined;
    try {
      this.credentialStore ??= new CredentialStore({ environment: this.environment });
      const credential = this.credentialStore.read();
      this.credentialStorage = {
        configured: Boolean(credential),
        ...(credential ? { name: credential.name } : {}),
        path: this.credentialStore.path,
        storage: "file",
        encrypted: false,
      };
      if (credential) {
        this.apiKey = credential.key;
        this.credentialSource = "plugin_file";
        return;
      }
      const loadedCredential = this.keychainLoader({ environment: this.environment });
      this.apiKey = typeof loadedCredential === "string" ? loadedCredential : loadedCredential?.key ?? "";
      this.credentialProfile = typeof loadedCredential === "object" ? loadedCredential?.profile ?? "" : "";
      this.credentialSource = this.apiKey ? "macos_keychain" : "none";
    } catch (error) {
      this.credentialError = {
        code: error.code ?? "CREDENTIAL_STORE_UNAVAILABLE",
        message: "MetaSo credential storage is unavailable or unsafe. Run metaso_auth_start or node scripts/auth.mjs to reconnect.",
      };
    }
  }

  capabilities() {
    this.refreshCredentials();
    return {
      backend: "direct_rest",
      baseUrl: this.baseUrl,
      authenticated: Boolean(this.apiKey),
      credentialSource: this.credentialSource,
      ...(this.credentialProfile ? { credentialProfile: this.credentialProfile } : {}),
      ...(this.credentialStorage ? { credentialStorage: this.credentialStorage } : {}),
      ...(this.credentialError ? { credentialError: this.credentialError } : {}),
      searchScopes: [...SEARCH_SCOPES],
      chatModels: [...CHAT_MODELS],
      reader: true,
      openSearch: true,
      deepResearch: true,
      topics: true,
      bookshelf: true,
      experimentalRemoteMcp: false,
      limits: {
        searchSize: [10, 20, 30, 40, 50, 100],
        recommendedSearchSizes: [10, 20, 30, 40, 50, 100],
        searchPage: [1, 10],
        maxUploadBytes: this.maxUploadBytes,
        requestTimeoutMs: this.timeoutMs,
      },
      knownCompatibility: {
        academicScope: "scholar",
        paperAliasAcceptedLocally: false,
        readerFormatControlledByAcceptHeader: true,
        bookshelfUrlEncoding: "application/x-www-form-urlencoded",
        http200MayContainBusinessError: true,
        identifierFieldsReturnedAsStrings: true,
        thinkingModelsStreamedUpstream: true,
      },
    };
  }

  requireApiKey() {
    this.refreshCredentials();
    if (this.credentialError) {
      throw new MetasoError(this.credentialError.message, {
        channel: "configuration", code: this.credentialError.code,
      });
    }
    if (!this.apiKey) {
      throw new MetasoError(
        "METASO_API_KEY is unavailable. Run metaso_auth_start or node scripts/auth.mjs to connect MetaSo, or configure METASO_API_KEY in the MCP server environment.",
        { channel: "configuration", code: "MISSING_API_KEY" },
      );
    }
  }

  async request(path, options = {}) {
    this.requireApiKey();
    const apiKey = this.apiKey;
    const url = new URL(path, `${this.baseUrl}/`).toString();
    const method = options.method ?? "GET";
    const retryableMethod = options.retryable ?? ["GET", "HEAD"].includes(method);
    const attempts = retryableMethod ? 3 : 1;
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(options.headers ?? {}),
          },
          body: options.body,
          signal: controller.signal,
        });
        const text = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const parsed = contentType.includes("json") ? parseJsonMaybe(text) : parseJsonMaybe(text);

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const error = new MetasoError(
            parsed?.message || parsed?.errMsg || `MetaSo HTTP ${response.status}`,
            {
              channel: "http",
              code: parsed?.code ?? parsed?.errCode,
              httpStatus: response.status,
              retryable,
              details: parsed ?? text.slice(0, 1000),
            },
          );
          if (retryable && attempt + 1 < attempts) {
            lastError = error;
            await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 150));
            continue;
          }
          throw error;
        }

        const businessError = detectBusinessError(parsed);
        if (businessError) {
          throw new MetasoError(businessError.message, {
            channel: "business",
            code: businessError.code,
            httpStatus: response.status,
            retryable: Number(businessError.code) === 500 || Number(businessError.code) === 5000,
            details: parsed,
          });
        }

        return {
          data: parsed ?? text,
          text,
          status: response.status,
          contentType,
          headers: response.headers,
        };
      } catch (error) {
        const normalized =
          error instanceof MetasoError
            ? error
            : new MetasoError(
                error?.name === "AbortError"
                  ? `MetaSo request timed out after ${this.timeoutMs} ms`
                  : `MetaSo network error: ${redactSecrets(error?.message ?? error)}`,
                {
                  channel: "network",
                  code: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
                  retryable: true,
                },
              );
        if (normalized.retryable && retryableMethod && attempt + 1 < attempts) {
          lastError = normalized;
          await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 150));
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new MetasoError("MetaSo request failed", { channel: "network" });
  }

  async requestJson(path, payload, options = {}) {
    return this.request(path, {
      method: options.method ?? "POST",
      headers: {
        Accept: options.accept ?? "application/json",
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(payload),
      retryable: options.retryable ?? false,
    });
  }

  async search(input) {
    assertObject(input);
    const query = assertNonEmptyString(input.q, "query");
    const scope = normalizeScope(input.scope);
    const size = optionalInteger(input.size, "size", 1, 100);
    if (size !== undefined && ![10, 20, 30, 40, 50, 100].includes(size)) {
      throw new MetasoError("size must be 10, 20, 30, 40, 50, or 100", { channel: "validation", code: "INVALID_ARGUMENT" });
    }
    const pageValue = typeof input.page === "string" && /^(?:[1-9]|10)$/.test(input.page) ? Number(input.page) : input.page;
    const page = optionalInteger(pageValue, "page", 1, 10);
    if (size !== undefined && page !== undefined) {
      throw new MetasoError("size and page are mutually exclusive", {
        channel: "validation",
        code: "MUTUALLY_EXCLUSIVE",
      });
    }
    const includeSummary = optionalBoolean(
      input.includeSummary,
      "includeSummary",
    );
    const includeRawContent = optionalBoolean(
      input.includeRawContent,
      "includeRawContent",
    );
    if (includeRawContent && scope !== "webpage") {
      throw new MetasoError("includeRawContent is supported only for webpage search", {
        channel: "validation",
        code: "RAW_CONTENT_SCOPE",
      });
    }
    const payload = {
      q: query,
      scope,
      includeSummary,
      includeRawContent,
      conciseSnippet: optionalBoolean(
        input.conciseSnippet,
        "conciseSnippet",
      ),
      ...(size !== undefined ? { size } : {}),
      ...(page !== undefined ? { page: String(page) } : {}),
    };
    const response = await this.requestJson("/api/v1/search", payload, { retryable: true });
    return response.data;
  }

  validatePublicUrl(rawUrl) {
    const url = assertNonEmptyString(rawUrl, "url");
    if (!this.allowPrivateUrls && !publicUrlAllowed(url)) {
      throw new MetasoError("url must be a public HTTP(S) URL", {
        channel: "validation",
        code: "UNSAFE_URL",
      });
    }
    return url;
  }

  async readUrl(input) {
    assertObject(input);
    const url = this.validatePublicUrl(input.url);
    const format = input.format ?? "json";
    if (!new Set(["json", "markdown"]).has(format)) {
      throw new MetasoError("format must be json or markdown", {
        channel: "validation",
        code: "INVALID_FORMAT",
      });
    }
    const response = await this.requestJson(
      "/api/v1/reader",
      { url },
      {
        accept: format === "json" ? "application/json" : "text/plain",
        retryable: true,
      },
    );
    if (format === "markdown") return { markdown: response.text };
    return response.data;
  }

  async answer(input) {
    assertObject(input);
    const model = normalizeModel(input.model);
    const scope = normalizeScope(input.scope);
    const format = input.format ?? "chat_completions";
    if (!new Set(["simple", "chat_completions"]).has(format)) {
      throw new MetasoError("format must be simple or chat_completions", {
        channel: "validation",
        code: "INVALID_FORMAT",
      });
    }
    const requestedStream = optionalBoolean(input.stream, "stream");
    const forceSafeThinkingStream = !requestedStream && new Set(["fast_thinking", "ds-r1"]).has(model);
    const payload = {
      model,
      ...(scope !== "webpage" ? { scope } : {}),
      ...(format === "simple" ? { format } : {}),
      stream: requestedStream || forceSafeThinkingStream,
      conciseSnippet: optionalBoolean(
        input.conciseSnippet,
        "conciseSnippet",
        true,
      ),
    };
    if (input.messages !== undefined) {
      if (!Array.isArray(input.messages) || input.messages.length === 0) {
        throw new MetasoError("messages must be a non-empty array", {
          channel: "validation",
          code: "INVALID_MESSAGES",
        });
      }
      payload.messages = input.messages.map((message, index) => {
        assertObject(message, `messages[${index}]`);
        const role = message.role;
        if (!new Set(["system", "user", "assistant"]).has(role)) {
          throw new MetasoError(`messages[${index}].role is invalid`, {
            channel: "validation",
            code: "INVALID_MESSAGES",
          });
        }
        return {
          role,
          content: assertNonEmptyString(message.content, `messages[${index}].content`),
        };
      });
    } else {
      payload.messages = [{ role: "user", content: assertNonEmptyString(input.question ?? input.q, "question") }];
    }

    const response = await this.requestJson("/api/v1/chat/completions", payload, {
      accept: payload.stream ? "text/event-stream" : "application/json",
      retryable: false,
    });
    if (!payload.stream || !response.contentType.includes("text/event-stream") && typeof response.data === "object") return sanitizeAnswerResponse(response.data);
    const events = parseSseText(response.text);
    const aggregate = aggregateChatSse(events);
    const sanitized = stripExposedReasoningTrace(aggregate.content);
    const normalizedAggregate = {
      ...aggregate,
      content: sanitized.text.trim(),
      eventCount: events.length,
      ...(sanitized.filtered ? { reasoningTraceFiltered: true } : {}),
    };
    if (!forceSafeThinkingStream) return normalizedAggregate;

    const common = {
      sources: normalizedAggregate.citations,
      highlights: normalizedAggregate.highlights,
      usage: normalizedAggregate.usage,
      model: normalizedAggregate.model ?? model,
      finishReason: normalizedAggregate.finishReason,
      eventCount: normalizedAggregate.eventCount,
      streamedUpstream: true,
      ...(normalizedAggregate.reasoningTraceFiltered
        ? { reasoningTraceFiltered: true }
        : {}),
      ...(normalizedAggregate.usage?.credits !== undefined
        ? { credits: normalizedAggregate.usage.credits }
        : {}),
    };
    if (format === "chat_completions") {
      return {
        ...common,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: normalizedAggregate.content },
            finish_reason: normalizedAggregate.finishReason ?? null,
          },
        ],
      };
    }
    return { ...common, answer: normalizedAggregate.content };
  }

  async openSearch(input) {
    assertObject(input);
    const payload = {
      question: assertNonEmptyString(input.question, "question"),
      lang: input.language ?? input.lang ?? "zh",
      sessionId: input.session_id ?? input.sessionId ?? null,
      stream: optionalBoolean(input.stream, "stream"),
      topicId: input.topic_id ?? input.topicId ?? null,
      searchTopicId: input.search_topic_id ?? input.searchTopicId ?? null,
      enableMix: optionalBoolean(input.enable_mix ?? input.enableMix, "enable_mix"),
      newEngine: optionalBoolean(input.new_engine ?? input.newEngine, "new_engine"),
      needHighlight: optionalBoolean(
        input.need_highlight ?? input.needHighlight,
        "need_highlight",
        true,
      ),
    };
    const response = await this.requestJson("/api/open/search/v2", payload, {
      accept: payload.stream ? "text/event-stream" : "application/json",
      retryable: false,
    });
    if (!payload.stream) return response.data?.data ?? response.data;
    const events = parseSseText(response.text);
    return aggregateOpenSse(events);
  }

  async createTopic(input) {
    assertObject(input);
    const payload = {
      name: assertNonEmptyString(input.name, "name"),
      ...(input.description ? { description: String(input.description) } : {}),
    };
    const response = await this.requestJson("/api/open/topic", payload, {
      method: "PUT",
      retryable: false,
    });
    return response.data?.data ?? response.data;
  }

  async loadUploadFile(filePath) {
    const absolutePath = resolve(assertNonEmptyString(filePath, "file_path"));
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new MetasoError(`file_path is not a regular file: ${absolutePath}`, {
        channel: "validation",
        code: "FILE_NOT_FOUND",
      });
    }
    if (fileStat.size > this.maxUploadBytes) {
      throw new MetasoError(
        `file exceeds upload limit (${fileStat.size} > ${this.maxUploadBytes} bytes)`,
        { channel: "validation", code: "FILE_TOO_LARGE" },
      );
    }
    return { absolutePath, bytes: await readFile(absolutePath), size: fileStat.size };
  }

  async uploadTopicFile(input) {
    assertObject(input);
    const dirRootId = assertNonEmptyString(
      input.dir_root_id ?? input.topic_dir_root_id ?? input.dirRootId,
      "dir_root_id",
    );
    const file = await this.loadUploadFile(input.file_path ?? input.filePath);
    const multipart = createMultipartBody("file", file.absolutePath, file.bytes);
    const response = await this.request(`/api/open/file/${encodeURIComponent(dirRootId)}`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": multipart.contentType },
      body: multipart.body,
      retryable: false,
    });
    const data = response.data?.data ?? response.data;
    return Array.isArray(data) ? data : [data];
  }

  async fileProgress(input) {
    assertObject(input);
    const fileId = assertNonEmptyString(input.file_id ?? input.fileId, "file_id");
    const response = await this.request(
      `/api/open/file/${encodeURIComponent(fileId)}/progress`,
      { retryable: true },
    );
    return {
      fileId,
      progress: response.data?.data ?? response.data,
    };
  }

  async waitFilesReady(input) {
    assertObject(input);
    const fileIds = input.file_ids ?? input.fileIds;
    if (!Array.isArray(fileIds) || fileIds.length === 0 || fileIds.length > 100) {
      throw new MetasoError("file_ids must contain 1 to 100 IDs", {
        channel: "validation",
        code: "INVALID_FILE_IDS",
      });
    }
    const ids = fileIds.map((id, index) => assertNonEmptyString(id, `file_ids[${index}]`));
    const timeoutSeconds = optionalInteger(input.timeout_seconds, "timeout_seconds", 1, 900) ?? 180;
    const intervalSeconds = optionalInteger(input.interval_seconds, "interval_seconds", 1, 30) ?? 2;
    const deadline = Date.now() + timeoutSeconds * 1000;
    const latest = new Map();
    while (Date.now() < deadline) {
      const statuses = await Promise.all(ids.map((fileId) => this.fileProgress({ file_id: fileId })));
      for (const statusItem of statuses) latest.set(statusItem.fileId, statusItem.progress);
      if (statuses.every((statusItem) => Number(statusItem.progress) === 100)) {
        return { ready: true, files: Object.fromEntries(latest), waitedMs: timeoutSeconds * 1000 - (deadline - Date.now()) };
      }
      await sleep(intervalSeconds * 1000);
    }
    return { ready: false, files: Object.fromEntries(latest), timeoutSeconds };
  }

  async deleteFiles(input) {
    assertObject(input);
    const values = input.file_ids ?? input.ids ?? (input.file_id ? [input.file_id] : undefined);
    if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
      throw new MetasoError("file_ids must contain 1 to 100 IDs", {
        channel: "validation",
        code: "INVALID_FILE_IDS",
      });
    }
    const ids = values.map((id, index) => assertNonEmptyString(id, `file_ids[${index}]`));
    const response = await this.requestJson("/api/open/file/trash", { ids }, { retryable: false });
    return { deleted: true, ids, response: response.data };
  }

  async deleteTopics(input) {
    assertObject(input);
    const values = input.topic_ids ?? input.ids ?? (input.topic_id ? [input.topic_id] : undefined);
    if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
      throw new MetasoError("topic_ids must contain 1 to 100 IDs", {
        channel: "validation",
        code: "INVALID_TOPIC_IDS",
      });
    }
    const ids = values.map((id, index) => assertNonEmptyString(id, `topic_ids[${index}]`));
    const response = await this.requestJson("/api/open/topic/trash", { ids }, { retryable: false });
    return { deleted: true, ids, response: response.data };
  }

  async uploadBook(input) {
    assertObject(input);
    const sourceType = input.source_type ?? input.sourceType;
    if (!new Set(["file", "url"]).has(sourceType)) {
      throw new MetasoError("source_type must be file or url", {
        channel: "validation",
        code: "INVALID_SOURCE_TYPE",
      });
    }
    if (sourceType === "url") {
      if (input.file_path || input.filePath) {
        throw new MetasoError("URL bookshelf import cannot include file_path", {
          channel: "validation",
          code: "MUTUALLY_EXCLUSIVE",
        });
      }
      const url = this.validatePublicUrl(input.url);
      const body = new URLSearchParams({ url }).toString();
      const response = await this.request("/api/open/book", {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        retryable: false,
      });
      return response.data?.data ?? response.data;
    }
    if (input.url) {
      throw new MetasoError("File bookshelf import cannot include url", {
        channel: "validation",
        code: "MUTUALLY_EXCLUSIVE",
      });
    }
    const file = await this.loadUploadFile(input.file_path ?? input.filePath);
    const multipart = createMultipartBody("file", file.absolutePath, file.bytes);
    const response = await this.request("/api/open/book", {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": multipart.contentType },
      body: multipart.body,
      retryable: false,
    });
    return response.data?.data ?? response.data;
  }

  async listFilesRecursively(directoryPath, options = {}) {
    const root = resolve(assertNonEmptyString(directoryPath, "directory_path"));
    const rootStat = await stat(root).catch(() => null);
    if (!rootStat?.isDirectory()) {
      throw new MetasoError(`directory_path is not a directory: ${root}`, {
        channel: "validation",
        code: "DIRECTORY_NOT_FOUND",
      });
    }
    const includeHidden = Boolean(options.includeHidden);
    const extensions = options.extensions?.length
      ? new Set(options.extensions.map((value) => String(value).toLowerCase().replace(/^\./, "")))
      : null;
    const maximum = options.maxFiles ?? 100;
    const files = [];
    const visit = async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith(".")) continue;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) {
          const extension = extname(entry.name).toLowerCase().replace(/^\./, "");
          if (!extensions || extensions.has(extension)) files.push(path);
          if (files.length > maximum) {
            throw new MetasoError(`directory contains more than max_files (${maximum})`, {
              channel: "validation",
              code: "TOO_MANY_FILES",
            });
          }
        }
      }
    };
    await visit(root);
    return files;
  }

  async uploadTopicDirectory(input) {
    assertObject(input);
    const dirRootId = assertNonEmptyString(
      input.dir_root_id ?? input.topic_dir_root_id ?? input.dirRootId,
      "dir_root_id",
    );
    const maxFiles = optionalInteger(input.max_files, "max_files", 1, 100) ?? 50;
    const concurrency = optionalInteger(input.concurrency, "concurrency", 1, 5) ?? 2;
    const files = await this.listFilesRecursively(input.directory_path, {
      includeHidden: input.include_hidden,
      extensions: input.extensions,
      maxFiles,
    });
    const uploaded = [];
    const failures = [];
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex;
        nextIndex += 1;
        const path = files[index];
        try {
          const result = await this.uploadTopicFile({ dir_root_id: dirRootId, file_path: path });
          uploaded.push({ path, files: result });
        } catch (error) {
          failures.push({ path, error: error instanceof MetasoError ? error.toJSON() : String(error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, worker));
    return { discovered: files.length, uploaded, failures };
  }
}

export const constants = {
  SEARCH_SCOPES: [...SEARCH_SCOPES],
  CHAT_MODELS: [...CHAT_MODELS],
};
