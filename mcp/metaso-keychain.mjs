import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const METASO_KEYCHAIN_SERVICE = "cc.jasonstu.metaso-search-neo.api-key";
export const LEGACY_METASO_KEYCHAIN_SERVICE = "com.jasonstudio.metaso-search-neo.api-key";

export function isLikelyMetaSoApiKey(value) {
  return (
    typeof value === "string" &&
    value.length >= 19 &&
    value.length <= 256 &&
    /^mk-[A-Za-z0-9]{16,}$/.test(value)
  );
}

export function isValidCredentialProfile(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(value);
}

function defaultProfileDirectory(environment) {
  if (environment.METASO_KEY_PROFILE_DIR) {
    return isAbsolute(environment.METASO_KEY_PROFILE_DIR)
      ? resolve(environment.METASO_KEY_PROFILE_DIR)
      : "";
  }
  if (environment.CODEX_HOME && !isAbsolute(environment.CODEX_HOME)) return "";
  const codexHome = environment.CODEX_HOME ? resolve(environment.CODEX_HOME) : join(homedir(), ".codex");
  return join(codexHome, "state", "metaso-search-neo", "key-profiles");
}

export function loadActiveCredentialProfile(options = {}) {
  const environment = options.environment ?? process.env;
  const profileDirectory = options.profileDirectory ?? defaultProfileDirectory(environment);
  if (!profileDirectory || !isAbsolute(profileDirectory)) return "";
  try {
    const profile = readFileSync(join(profileDirectory, "active-profile"), "utf8").trim();
    return isValidCredentialProfile(profile) ? profile : "";
  } catch {
    return "";
  }
}

export function loadMetaSoCredentialFromKeychain(options = {}) {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  if (platform !== "darwin" || environment.METASO_DISABLE_KEYCHAIN === "true") {
    return { key: "", profile: "" };
  }

  const securityBin = options.securityBin ?? "/usr/bin/security";
  const selectedProfile =
    options.profile ?? loadActiveCredentialProfile({ environment, profileDirectory: options.profileDirectory });
  if (!selectedProfile) return { key: "", profile: "" };

  const services = options.service
    ? [options.service]
    : [METASO_KEYCHAIN_SERVICE, LEGACY_METASO_KEYCHAIN_SERVICE];
  for (const service of services) {
    const result = spawnSync(
      securityBin,
      ["find-generic-password", "-a", selectedProfile, "-s", service, "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: options.timeoutMs ?? 3_000,
        maxBuffer: 4_096,
        env: environment,
      },
    );
    if (result.error || result.status !== 0) continue;
    const key = String(result.stdout ?? "").replace(/[\r\n]+$/, "");
    if (isLikelyMetaSoApiKey(key)) return { key, profile: selectedProfile };
  }
  return { key: "", profile: selectedProfile };
}

export function loadMetaSoApiKeyFromKeychain(options = {}) {
  return loadMetaSoCredentialFromKeychain(options).key;
}
