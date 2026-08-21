#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const pluginRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stateDirectory = await mkdtemp(join(tmpdir(), "metaso-mcp-smoke-"));
const child = spawn(process.execPath, [join(pluginRoot, "mcp/server.mjs"), "--stdio"], {
  cwd: pluginRoot,
  env: { ...process.env, METASO_STATE_DIR: stateDirectory, METASO_API_KEY: "" },
  stdio: ["pipe", "pipe", "pipe"],
});

const messages = [];
let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  while (true) {
    const newline = stdout.indexOf("\n");
    if (newline === -1) break;
    const line = stdout.slice(0, newline);
    stdout = stdout.slice(newline + 1);
    if (line.trim()) messages.push(JSON.parse(line));
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0.0" },
  },
});
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "metaso_capabilities", arguments: {} },
});
child.stdin.end();

const exitCode = await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(new Error("MCP smoke test timed out"));
  }, 5_000);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolvePromise(code);
  });
});

try {
  assert.equal(exitCode, 0, stderr);
  const initialize = messages.find((message) => message.id === 1);
  const tools = messages.find((message) => message.id === 2);
  const capabilities = messages.find((message) => message.id === 3);
  assert.equal(initialize.result.protocolVersion, "2025-06-18");
  assert.equal(tools.result.tools.length, 17);
  assert.equal(capabilities.result.structuredContent.authenticated, false);
  assert.equal(capabilities.result.structuredContent.researchFrontier.enabled, false);
  process.stdout.write("MCP smoke test passed: initialize, tools/list, and capabilities.\n");
} finally {
  await rm(stateDirectory, { recursive: true, force: true });
}
