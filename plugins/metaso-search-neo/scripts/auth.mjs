#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { CredentialStore } from "../mcp/credentials.mjs";
import { AuthManager } from "../mcp/auth.mjs";

export async function main(args = process.argv.slice(2)) {
  const store = new CredentialStore();
  if (args.includes("--help")) {
    process.stdout.write("Usage: node scripts/auth.mjs [--name NAME] [--import-existing] [--replace]\n       node scripts/auth.mjs --status\n       node scripts/auth.mjs --stdin --name NAME [--replace]\nBrowser setup installs pinned Playwright on first use and opens an isolated browser. Complete login yourself.\n--stdin imports a Key from redirected stdin, never from a command argument.\n");
    return;
  }
  if (args.includes("--status")) { process.stdout.write(`${JSON.stringify(store.status())}\n`); return; }
  const options = { mode: "create", replace: false };
  let stdin = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) options.name = args[++i];
    else if (args[i] === "--import-existing") options.mode = "import";
    else if (args[i] === "--replace") options.replace = true;
    else if (args[i] === "--stdin") stdin = true;
    else throw new Error("Unknown or incomplete option. Run --help.");
  }
  if (options.mode === "import" && !options.name) throw new Error("--import-existing requires --name.");
  if (stdin) {
    if (process.stdin.isTTY) throw new Error("Use redirected stdin from a local secret source; do not paste a Key into shell command arguments.");
    let key = "";
    for await (const chunk of process.stdin) { key += chunk; if (key.length > 512) throw new Error("Input exceeds the Key length limit."); }
    process.stdout.write(`${JSON.stringify(store.write({ key: key.trim(), name: options.name ?? "Manual import", replace: options.replace }))}\n`);
    return;
  }
  const auth = new AuthManager({ store });
  const abort = () => { void auth.cancel(); };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  auth.start(options);
  let previous;
  const report = () => { if (previous !== auth.session.state) { previous = auth.session.state; process.stdout.write(`MetaSo connection: ${previous}\n`); } };
  report();
  const timer = setInterval(report, 500);
  try { await auth.pending; report(); process.stdout.write(`${JSON.stringify(auth.status())}\n`); if (auth.session.state !== "complete") process.exitCode = 1; }
  finally { clearInterval(timer); process.off("SIGINT", abort); process.off("SIGTERM", abort); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => { process.stderr.write("MetaSo setup failed. Run --help; check private storage permissions and npm/browser availability. No Key is printed.\n"); process.exitCode = 1; });
}
