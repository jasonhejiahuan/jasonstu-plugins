#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { MetasoClient, redactSecrets } from "./metaso-client.mjs";
import { PluginSettings } from "./settings.mjs";
import { callTool, listTools } from "./tools.mjs";
import { AuthManager } from "./auth.mjs";

const SERVER_INFO = {
  name: "metaso-search-neo",
  version: "0.3.0",
};
const SUPPORTED_PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message: redactSecrets(message),
      ...(data === undefined ? {} : { data }),
    },
  };
}

export function createContext(options = {}) {
  return {
    client: options.client ?? new MetasoClient(options.clientOptions),
    settings: options.settings ?? new PluginSettings(options.settingsOptions),
    auth: options.auth ?? new AuthManager({ environment: options.clientOptions?.environment, ...options.authOptions }),
  };
}

export async function handleRequest(message, context) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return jsonRpcError(message.id, -32600, "Invalid Request");
  }

  const isNotification = message.id === undefined;
  try {
    switch (message.method) {
      case "initialize": {
        if (isNotification) return null;
        const requested = message.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2024-11-05";
        return jsonRpcResult(message.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Use MetaSo for structured search, Reader, cited answers, bounded deep research, and topic knowledge bases. Research Frontier is plugin-global and disabled by default.",
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return isNotification ? null : jsonRpcResult(message.id, {});
      case "tools/list":
        return isNotification ? null : jsonRpcResult(message.id, { tools: listTools() });
      case "tools/call": {
        if (isNotification) return null;
        const name = message.params?.name;
        if (typeof name !== "string" || !name) {
          return jsonRpcError(message.id, -32602, "tools/call requires params.name");
        }
        const result = await callTool(name, message.params?.arguments ?? {}, context);
        return jsonRpcResult(message.id, result);
      }
      default:
        return isNotification
          ? null
          : jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
    }
  } catch (error) {
    return isNotification
      ? null
      : jsonRpcError(message.id, -32603, "Internal error", {
          message: redactSecrets(error?.message ?? error),
        });
  }
}

export async function runStdio(options = {}) {
  const context = options.context ?? createContext(options);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        process.stdout.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`);
        continue;
      }
      void handleRequest(message, context)
        .then((response) => {
          if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
        })
        .catch((error) => {
          const response = jsonRpcError(message?.id, -32603, "Internal error", {
            message: redactSecrets(error?.message ?? error),
          });
          process.stdout.write(`${JSON.stringify(response)}\n`);
        });
    }
  });
  process.stdin.on("end", () => {
    void context.auth?.cancel();
    if (buffer.trim()) {
      process.stdout.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`);
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runStdio().catch((error) => {
    process.stderr.write(`metaso-search-neo MCP failed: ${redactSecrets(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
