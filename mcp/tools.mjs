import { MetasoError } from "./metaso-client.mjs";
import { runDeepResearch } from "./deep-research.mjs";
import { FRONTIER_NAME } from "./settings.mjs";
import { validateToolArguments } from "./schema.mjs";
import { basename } from "node:path";

const SEARCH_SCOPE_SCHEMA = {
  type: "string",
  enum: ["webpage", "document", "scholar", "image", "video", "podcast", "paper"],
  description: "Search scope. paper is accepted as a compatibility alias and converted to scholar.",
};

const MODEL_SCHEMA = {
  type: "string",
  enum: ["fast", "fast_thinking", "ds-r1"],
};

const TOOLS = [
  {
    name: "metaso_capabilities",
    description:
      "Show MetaSo scopes, models, limits, compatibility rules, authentication state, and the plugin-wide Research Frontier setting. Does not call a billable API.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "metaso_research_frontier",
    description:
      `Read or change the plugin-wide ${FRONTIER_NAME}. It is disabled by default. Enabling it raises default research depth, source/read limits, and model quality for later calls.`,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "enable", "disable"],
          default: "status",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_resource_catalog",
    description:
      "List topic, topic-file, and bookshelf IDs recorded locally by this plugin. Use it to recover exact IDs before status checks or destructive deletion. It cannot list resources created outside this plugin.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["all", "topics", "files", "books"], default: "all" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_search",
    description:
      "Search webpages, documents, scholarly works, images, videos, or podcasts. Returns structured MetaSo results and per-call credits. size and page are mutually exclusive; raw content is webpage-only.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        scope: SEARCH_SCOPE_SCHEMA,
        size: { type: "integer", minimum: 1, maximum: 100 },
        page: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean", default: false },
        include_raw_content: {
          type: "boolean",
          default: false,
          description: "Fetch full source text. Webpage-only and may add credits per result.",
        },
        concise_snippet: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_read_url",
    description:
      "Extract a public HTTP(S) page through MetaSo Reader. JSON mode includes title, canonical URL, Markdown, and credits; Markdown mode returns text only.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1 },
        format: { type: "string", enum: ["json", "markdown"], default: "json" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_answer",
    description:
      "Answer a question with MetaSo retrieval and citations. Supports simple questions, message history, six search scopes, three explicit models, and aggregated SSE output.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1 },
        messages: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["role", "content"],
            properties: {
              role: { type: "string", enum: ["system", "user", "assistant"] },
              content: { type: "string", minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        scope: SEARCH_SCOPE_SCHEMA,
        model: MODEL_SCHEMA,
        format: { type: "string", enum: ["simple", "chat_completions"] },
        stream: { type: "boolean", default: false },
        concise_snippet: { type: "boolean", default: true },
      },
      oneOf: [{ required: ["question"] }, { required: ["messages"] }],
      additionalProperties: false,
    },
  },
  {
    name: "metaso_research",
    description:
      "Use MetaSo's native Open/SDK generative search for cited answers, session follow-ups, language selection, highlights, and optional aggregated SSE. This is a single research turn, not the multi-round deep-research pipeline.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 1 },
        language: { type: "string", default: "zh" },
        session_id: { type: ["string", "null"] },
        stream: { type: "boolean", default: false },
        enable_mix: { type: "boolean" },
        new_engine: { type: "boolean" },
        need_highlight: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_deep_research",
    description:
      "Run bounded multi-round research: plan queries, search multiple scopes, read selected sources, identify evidence gaps, synthesize with citations, and optionally critique/revise. Deep/high-limit configurations require allow_high_cost=true unless Research Frontier is globally enabled.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string", minLength: 1 },
        depth: { type: "string", enum: ["quick", "standard", "deep"] },
        language: { type: "string", default: "zh" },
        scopes: { type: "array", minItems: 1, uniqueItems: true, items: SEARCH_SCOPE_SCHEMA },
        model: MODEL_SCHEMA,
        max_iterations: { type: "integer", minimum: 1, maximum: 4 },
        queries_per_round: { type: "integer", minimum: 1, maximum: 6 },
        max_sources: { type: "integer", minimum: 5, maximum: 60 },
        max_reads: { type: "integer", minimum: 0, maximum: 15 },
        allow_high_cost: {
          type: "boolean",
          default: false,
          description: "Set true only after the user explicitly asks for deep/high-cost research.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_topic_create",
    description:
      "Create a MetaSo topic knowledge base. Returns both topic id (search/delete) and dirRootId (file upload); preserve both identifiers.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_topic_upload",
    description:
      "Upload one local file to a topic using its dir_root_id. The returned file must finish asynchronous parsing before topic search.",
    inputSchema: {
      type: "object",
      required: ["dir_root_id", "file_path"],
      properties: {
        dir_root_id: { type: "string", minLength: 1 },
        file_path: { type: "string", minLength: 1 },
        wait_until_ready: { type: "boolean", default: false },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 900, default: 180 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_topic_upload_directory",
    description:
      "Recursively upload regular non-symlink files from a local directory to a topic. Hidden files are skipped by default; concurrency and file count are bounded.",
    inputSchema: {
      type: "object",
      required: ["dir_root_id", "directory_path"],
      properties: {
        dir_root_id: { type: "string", minLength: 1 },
        directory_path: { type: "string", minLength: 1 },
        extensions: { type: "array", items: { type: "string" }, uniqueItems: true },
        include_hidden: { type: "boolean", default: false },
        max_files: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        concurrency: { type: "integer", minimum: 1, maximum: 5, default: 2 },
        wait_until_ready: { type: "boolean", default: false },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 900, default: 300 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_file_status",
    description: "Get asynchronous parse progress for one topic or bookshelf file ID.",
    inputSchema: {
      type: "object",
      required: ["file_id"],
      properties: { file_id: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_wait_files_ready",
    description: "Poll 1-100 file IDs until all reach progress 100 or the bounded timeout expires.",
    inputSchema: {
      type: "object",
      required: ["file_ids"],
      properties: {
        file_ids: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 900, default: 180 },
        interval_seconds: { type: "integer", minimum: 1, maximum: 30, default: 2 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_topic_search",
    description:
      "Search and answer against an Open API topic. Uses searchTopicId internally, supports follow-up session IDs, language, highlights, and aggregated SSE.",
    inputSchema: {
      type: "object",
      required: ["topic_id", "question"],
      properties: {
        topic_id: { type: "string", minLength: 1 },
        question: { type: "string", minLength: 1 },
        session_id: { type: ["string", "null"] },
        language: { type: "string", default: "zh" },
        stream: { type: "boolean", default: false },
        need_highlight: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_file_delete",
    description:
      "Permanently move one or more topic/bookshelf files to trash by file ID. This is destructive; call only when the user clearly requests deletion and IDs are exact.",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["file_ids"],
      properties: {
        file_ids: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_topic_delete",
    description:
      "Permanently move one or more topics to trash by topic ID. This is destructive; call only when the user clearly requests deletion and IDs are exact.",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["topic_ids"],
      properties: {
        topic_ids: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "metaso_bookshelf_upload",
    description:
      "Upload a local file or import a public URL into MetaSo Bookshelf. URL mode uses form encoding; file mode uses multipart. Poll and delete using the returned fileId, not Book.id.",
    inputSchema: {
      type: "object",
      required: ["source_type"],
      properties: {
        source_type: { type: "string", enum: ["file", "url"] },
        file_path: { type: "string", minLength: 1 },
        url: { type: "string", minLength: 1 },
        wait_until_ready: { type: "boolean", default: false },
        timeout_seconds: { type: "integer", minimum: 1, maximum: 900, default: 180 },
      },
      oneOf: [
        {
          required: ["source_type", "file_path"],
          properties: { source_type: { const: "file" } },
          not: { required: ["url"] },
        },
        {
          required: ["source_type", "url"],
          properties: { source_type: { const: "url" } },
          not: { required: ["file_path"] },
        },
      ],
      additionalProperties: false,
    },
  },
];

const NOTICE_ELIGIBLE_TOOLS = new Set([
  "metaso_search",
  "metaso_read_url",
  "metaso_answer",
  "metaso_research",
  "metaso_deep_research",
  "metaso_topic_search",
]);

function jsonContent(value) {
  return JSON.stringify(value, null, 2);
}

function resultText(toolName, value) {
  if (toolName === "metaso_deep_research" && typeof value?.report === "string") return value.report;
  if (toolName === "metaso_read_url" && typeof value?.markdown === "string") return value.markdown;
  return jsonContent(value);
}

function toolResult(toolName, value, notice = null) {
  const normalized = value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };
  const text = `${resultText(toolName, value)}${notice ? `\n\n---\n\n${notice}` : ""}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: notice ? { ...normalized, pluginNotice: notice } : normalized,
  };
}

function errorResult(error) {
  const normalized =
    error instanceof MetasoError
      ? error.toJSON()
      : {
          channel: "internal",
          message: String(error?.message ?? error),
          retryable: false,
        };
  return {
    isError: true,
    content: [{ type: "text", text: jsonContent({ error: normalized }) }],
    structuredContent: { error: normalized },
  };
}

function frontierDefaults(toolName, args, enabled) {
  if (!enabled) return { ...args };
  switch (toolName) {
    case "metaso_search":
      return args.size === undefined && args.page === undefined ? { size: 20, ...args } : { ...args };
    case "metaso_answer":
      return { model: "fast_thinking", ...args };
    case "metaso_research":
      return { enable_mix: true, new_engine: true, ...args };
    case "metaso_deep_research":
      if (args.depth !== undefined && args.depth !== "deep") {
        return { model: "fast_thinking", ...args };
      }
      return {
        depth: "deep",
        max_iterations: 3,
        max_sources: 48,
        max_reads: 12,
        model: "fast_thinking",
        allow_high_cost: true,
        ...args,
      };
    default:
      return { ...args };
  }
}

function uploadedFileIds(uploadResult) {
  const ids = [];
  for (const entry of uploadResult ?? []) {
    const id = entry?.id ?? entry?.fileId;
    if (id) ids.push(String(id));
  }
  return ids;
}

async function updateCatalogSafely(operation) {
  try {
    await operation();
    return null;
  } catch (error) {
    return `MetaSo API operation succeeded, but the plugin-local resource catalog could not be updated: ${String(error?.message ?? error)}`;
  }
}

async function waitReadinessSafely(client, fileIds, timeoutSeconds) {
  if (!fileIds.length) return { readiness: null, readinessError: null };
  try {
    return {
      readiness: await client.waitFilesReady({
        file_ids: fileIds,
        timeout_seconds: timeoutSeconds,
      }),
      readinessError: null,
    };
  } catch (error) {
    const normalized = error instanceof MetasoError ? error.toJSON() : { message: String(error) };
    return {
      readiness: null,
      readinessError: {
        ...normalized,
        note: "Upload succeeded. Do not repeat the upload; check these file IDs with metaso_file_status.",
      },
    };
  }
}

export function listTools() {
  return TOOLS;
}

export async function callTool(name, args, context) {
  const { client, settings } = context;
  try {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new MetasoError(`Unknown tool: ${name}`, {
        channel: "validation",
        code: "UNKNOWN_TOOL",
      });
    }
    validateToolArguments(tool, args ?? {});

    if (name === "metaso_capabilities") {
      const current = await settings.read();
      return toolResult(name, {
        ...client.capabilities(),
        researchFrontier: {
          name: FRONTIER_NAME,
          enabled: current.researchFrontier,
          default: false,
          firstUseNoticeShown: current.firstUseNoticeShown,
          stateWarning: settings.warning,
        },
      });
    }

    if (name === "metaso_research_frontier") {
      const action = args?.action ?? "status";
      if (!new Set(["status", "enable", "disable"]).has(action)) {
        throw new MetasoError("action must be status, enable, or disable", {
          channel: "validation",
          code: "INVALID_ACTION",
        });
      }
      const current =
        action === "status"
          ? await settings.read()
          : await settings.setFrontier(action === "enable");
      return toolResult(name, {
        name: FRONTIER_NAME,
        enabled: current.researchFrontier,
        scope: "plugin-global",
        stateWarning: settings.warning,
        message: current.researchFrontier
          ? "Research Frontier is enabled. Higher-depth defaults apply to later research calls."
          : "Research Frontier is disabled. Standard defaults apply.",
      });
    }

    if (name === "metaso_resource_catalog") {
      return toolResult(name, {
        scope: "plugin-local",
        limitation: "Only resources created or uploaded through this plugin are recorded.",
        ...(await settings.resourceCatalog(args?.kind ?? "all")),
      });
    }

    const currentSettings = await settings.read();
    const input = frontierDefaults(name, args ?? {}, currentSettings.researchFrontier);
    let value;
    switch (name) {
      case "metaso_search":
        value = await client.search(input);
        break;
      case "metaso_read_url":
        value = await client.readUrl(input);
        break;
      case "metaso_answer":
        value = await client.answer(input);
        break;
      case "metaso_research":
        value = await client.openSearch(input);
        break;
      case "metaso_deep_research":
        value = await runDeepResearch(client, input);
        break;
      case "metaso_topic_create":
        value = await client.createTopic(input);
        {
          const catalogWarning = await updateCatalogSafely(() => settings.recordTopic(value));
          if (catalogWarning) value = { ...value, catalogWarning };
        }
        break;
      case "metaso_topic_upload": {
        const uploaded = await client.uploadTopicFile(input);
        const catalogWarning = await updateCatalogSafely(() =>
          settings.recordFiles(uploaded, {
            dirRootId: input.dir_root_id,
            fileName: basename(input.file_path),
          }),
        );
        const fileIds = uploadedFileIds(uploaded);
        const readinessResult = input.wait_until_ready
          ? await waitReadinessSafely(client, fileIds, input.timeout_seconds)
          : { readiness: null, readinessError: null };
        value = {
          uploaded,
          fileIds,
          ...readinessResult,
          ...(catalogWarning ? { catalogWarning } : {}),
        };
        break;
      }
      case "metaso_topic_upload_directory": {
        const uploaded = await client.uploadTopicDirectory(input);
        const catalogFiles = uploaded.uploaded.flatMap((entry) =>
          (entry.files ?? []).map((file) => ({
            ...file,
            fileName: file.fileName ?? file.file_name ?? basename(entry.path),
          })),
        );
        const catalogWarning = await updateCatalogSafely(() =>
          settings.recordFiles(catalogFiles, { dirRootId: input.dir_root_id }),
        );
        const fileIds = uploaded.uploaded.flatMap((entry) => uploadedFileIds(entry.files));
        const readinessResult = input.wait_until_ready
          ? await waitReadinessSafely(client, fileIds, input.timeout_seconds)
          : { readiness: null, readinessError: null };
        value = {
          ...uploaded,
          fileIds,
          ...readinessResult,
          ...(catalogWarning ? { catalogWarning } : {}),
        };
        break;
      }
      case "metaso_file_status":
        value = await client.fileProgress(input);
        break;
      case "metaso_wait_files_ready":
        value = await client.waitFilesReady(input);
        break;
      case "metaso_topic_search":
        value = await client.openSearch({
          question: input.question,
          search_topic_id: input.topic_id,
          session_id: input.session_id,
          language: input.language,
          stream: input.stream,
          need_highlight: input.need_highlight,
          ...(currentSettings.researchFrontier ? { enable_mix: true, new_engine: true } : {}),
        });
        break;
      case "metaso_file_delete":
        value = await client.deleteFiles(input);
        {
          const catalogWarning = await updateCatalogSafely(() => settings.removeFiles(input.file_ids));
          if (catalogWarning) value = { ...value, catalogWarning };
        }
        break;
      case "metaso_topic_delete":
        value = await client.deleteTopics(input);
        {
          const catalogWarning = await updateCatalogSafely(() => settings.removeTopics(input.topic_ids));
          if (catalogWarning) value = { ...value, catalogWarning };
        }
        break;
      case "metaso_bookshelf_upload": {
        const book = await client.uploadBook(input);
        const catalogWarning = await updateCatalogSafely(() => settings.recordBook(book));
        const fileId = book?.fileId ?? book?.file_id;
        const readinessResult = input.wait_until_ready && fileId
          ? await waitReadinessSafely(client, [String(fileId)], input.timeout_seconds)
          : { readiness: null, readinessError: null };
        value = {
          book,
          fileId,
          ...readinessResult,
          ...(catalogWarning ? { catalogWarning } : {}),
        };
        break;
      }
      default:
        throw new MetasoError(`Tool handler missing: ${name}`, {
          channel: "internal",
          code: "MISSING_HANDLER",
        });
    }

    let notice = null;
    if (NOTICE_ELIGIBLE_TOOLS.has(name)) {
      notice = (await settings.consumeFirstUseNotice()).notice;
    }
    return toolResult(name, value, notice);
  } catch (error) {
    return errorResult(error);
  }
}
