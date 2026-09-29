export const ACCOUNT_URL = "https://metaso.cn/meta-user-info";
const FIELDS = { "用户名": "username", "手机号码": "phone", "电子邮箱": "email", "账号类型": "accountType" };

// Only these four display fields may leave the account page. They are not a
// stable account identifier; masked phone numbers and names can collide.
export function profileFromRows(rows) {
  const profile = {};
  for (const { label, value } of rows) {
    const field = typeof label === "string" && Object.hasOwn(FIELDS, label.trim()) ? FIELDS[label.trim()] : undefined;
    const text = typeof value === "string" ? value.trim() : undefined;
    if (!field || typeof text !== "string" || !text || text.length > 160 || /[\u0000-\u001f\u007f]|mk-[A-Za-z0-9]{16,}/u.test(text)) continue;
    if (profile[field] && profile[field] !== text) throw new Error("Ambiguous account profile.");
    profile[field] = text;
  }
  return profile;
}

export function validateCredentialMetadata(metadata) {
  if (metadata === undefined) return undefined;
  const invalid = () => { throw new Error("Invalid credential metadata."); };
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) invalid();
  if (Object.keys(metadata).some(k => !["account", "accountProfileStatus", "quotaScope"].includes(k)) || metadata.quotaScope !== "account" || !["available", "partial", "unavailable"].includes(metadata.accountProfileStatus)) invalid();
  const account = metadata.account;
  if (metadata.accountProfileStatus === "unavailable") {
    if (account !== undefined) invalid();
    return { accountProfileStatus: "unavailable", quotaScope: "account" };
  }
  if (!account || typeof account !== "object" || Array.isArray(account) || Object.keys(account).some(k => ![...Object.values(FIELDS), "source", "capturedAt"].includes(k))) invalid();
  const profile = profileFromRows(Object.entries(FIELDS).map(([label, field]) => ({ label, value: account[field] })));
  const count = Object.keys(profile).length;
  if (!count || Object.values(FIELDS).some(k => account[k] !== profile[k]) || account.source !== ACCOUNT_URL || typeof account.capturedAt !== "string" || !Number.isFinite(Date.parse(account.capturedAt)) || metadata.accountProfileStatus !== (count === 4 ? "available" : "partial")) invalid();
  return { account: { ...profile, source: ACCOUNT_URL, capturedAt: account.capturedAt }, accountProfileStatus: metadata.accountProfileStatus, quotaScope: "account" };
}

export async function collectAccountMetadata({ context, prepare, signal }) {
  let browser;
  const unavailable = { accountProfileStatus: "unavailable", quotaScope: "account" };
  try {
    if (signal.aborted) return unavailable;
    // No path: session state stays in memory, never in a profile or trace file.
    const storageState = await context.storageState();
    browser = await prepare();
    const abort = () => { void browser.close().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) return unavailable;
      const headless = await browser.newContext({ storageState, acceptDownloads: false, serviceWorkers: "block" });
      const page = await headless.newPage();
      await page.goto(ACCOUNT_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForFunction(() => {
        const labels = [...document.querySelectorAll('[class*="user-info_user-info-label__"]')].map(n => n.textContent.trim());
        return ["用户名", "手机号码", "电子邮箱", "账号类型"].every(label => labels.includes(label));
      }, undefined, { timeout: 8_000 }).catch(() => {});
      if (page.url().split(/[?#]/)[0] !== ACCOUNT_URL) return unavailable;
      const rows = await page.evaluate(() => [...document.querySelectorAll('[class*="user-info_user-info-container-item-info__"]')].flatMap(row => {
        const label = row.querySelector('[class*="user-info_user-info-label__"]')?.textContent?.trim();
        if (!["用户名", "手机号码", "电子邮箱", "账号类型"].includes(label)) return [];
        return [{ label, value: row.querySelector('[class*="user-info_user-info-value__"]')?.textContent?.trim() }];
      }));
      const profile = profileFromRows(rows);
      const count = Object.keys(profile).length;
      if (!count) return unavailable;
      return validateCredentialMetadata({ account: { ...profile, source: ACCOUNT_URL, capturedAt: new Date().toISOString() }, accountProfileStatus: count === 4 ? "available" : "partial", quotaScope: "account" });
    } finally { signal.removeEventListener("abort", abort); }
  } catch { return unavailable; }
  finally { await browser?.close().catch(() => {}); }
}
