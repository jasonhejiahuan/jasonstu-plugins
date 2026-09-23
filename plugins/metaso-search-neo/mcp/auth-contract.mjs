import { randomUUID } from "node:crypto";

export const METASO_API_KEYS_URL = "https://metaso.cn/search-api/api-keys";

export class AuthInputError extends Error {
  constructor() {
    super("Use an API Key name of 1–20 UTF-16 code units without control characters or API Keys.");
    this.name = "AuthInputError";
    this.code = "INVALID_KEY_NAME";
  }
}

export function validateKeyName(value) {
  if (typeof value !== "string") throw new AuthInputError();
  const name = value.trim();
  if (!name || name.length > 20 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name) || /mk-[A-Za-z0-9]{16,}/.test(name)) throw new AuthInputError();
  return name;
}

export function defaultKeyName() {
  return `Codex-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 6)}`;
}
