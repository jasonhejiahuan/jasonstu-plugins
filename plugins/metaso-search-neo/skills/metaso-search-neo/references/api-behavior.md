# MetaSo behavior reference

Read this reference when selecting advanced parameters, interpreting failures, or troubleshooting the bundled MCP tools.

## Tool-to-API map

| Tool | MetaSo endpoint |
|---|---|
| `metaso_capabilities` | Plugin-local capability report; no MetaSo call |
| `metaso_research_frontier` | Plugin-local settings; no MetaSo call |
| `metaso_resource_catalog` | Plugin-local state only; no MetaSo call |
| `metaso_search` | `POST /api/v1/search` |
| `metaso_read_url` | `POST /api/v1/reader` |
| `metaso_answer` | `POST /api/v1/chat/completions` |
| `metaso_research` | `POST /api/open/search/v2` |
| `metaso_deep_research` | Bounded orchestration over search, Reader, and answer |
| `metaso_topic_create` | `PUT /api/open/topic` |
| `metaso_topic_upload` | `PUT /api/open/file/{dirRootId}` |
| `metaso_topic_upload_directory` | Repeated bounded `PUT /api/open/file/{dirRootId}` calls |
| `metaso_file_status` | `GET /api/open/file/{fileId}/progress` |
| `metaso_wait_files_ready` | Bounded polling of `GET /api/open/file/{fileId}/progress` |
| `metaso_file_delete` | `POST /api/open/file/trash` |
| `metaso_topic_delete` | `POST /api/open/topic/trash` |
| `metaso_topic_search` | `POST /api/open/search/v2` with `searchTopicId` |
| `metaso_bookshelf_upload` | `PUT /api/open/book` |

## Stable enums

Search scopes are `webpage`, `document`, `scholar`, `image`, `video`, and `podcast`. Use `paper` only when working with the separate official remote MCP schema.

Chat models are `fast`, `fast_thinking`, and `ds-r1`. Always pass an explicit model; MetaSo's omitted/invalid-model behavior is not reliable.

All returned identifier fields are normalized to strings before JavaScript number parsing can lose precision. Always replay the returned `sessionId` string unchanged for native-research or topic-search follow-ups.

## Request invariants

- Search `size` and `page` are mutually exclusive. Prefer the UI sizes 10/20/30/40/50/100. Page accepts integer or digit string 1–10 and is serialized as a string. Neither control guarantees the returned count.
- Official `q`, `includeSummary`, `includeRawContent`, and `conciseSnippet` names are exposed by the tools without legacy aliases.
- Answer defaults to `chat_completions` (omitted upstream); only explicit `simple` is sent. Questions are serialized as `messages`. Webpage scope is omitted upstream. Model is a reasoning/latency choice, not a cost multiplier.
- `include_raw_content` is webpage-only and can add credits per returned page.
- Reader response format is controlled by the HTTP `Accept` header. The client handles this.
- Bookshelf URL import must be `application/x-www-form-urlencoded`; JSON URL bodies can return a business 500.
- Topic upload uses `dirRootId`; topic search uses the topic `id` as `searchTopicId`.
- Book progress/deletion uses `fileId`, not Book `id`.

## Error semantics

MetaSo often returns HTTP 200 for business errors. The MCP client rejects nonzero `errCode` or `code` and returns a structured tool error. Common observed codes include:

| Code | Meaning observed |
|---:|---|
| 2005 | Invalid public API key |
| 401 | Invalid Open API authentication |
| 400 / 1000 | Invalid parameters |
| 4000 | Reader data not found |
| 404 | Topic/file deleted or inaccessible |
| 500 / 5000 | Server or internal error |

Unknown codes must be preserved. Retry only network failures, 429, transport 5xx, or an explicitly retryable error. Do not retry authentication, validation, or not-found errors.

Tool arguments are validated against the advertised JSON Schemas inside the MCP server. Extra fields, ambiguous answer inputs, duplicate destructive IDs, and mixed bookshelf file/URL modes are rejected before an API call.

## Streaming

The server aggregates MetaSo SSE because MCP stdio tool calls return one result. Chat streams can contain citations, content, highlights, final usage, and `[DONE]`. Open streams can contain `balance`, `query`, `set-reference`, `heartbeat`, `append-text`, `answer-link-num-highlights`, and `[DONE]`.

The plugin returns compact event counts instead of the duplicate raw event list and deduplicates citations/highlights. For `fast_thinking` and `ds-r1`, a caller's non-stream request is streamed upstream and normalized back to a non-stream result; this prevents upstream reasoning traces from being exposed as answer text.

## Research Frontier

`metaso_research_frontier` stores a plugin-global profile outside the immutable plugin package. Default state is disabled. When enabled, it raises only unspecified defaults:

- search size 100 (maximum in the supplied API guide; actual count may be lower);
- answer model `fast_thinking`;
- native research `enableMix=true` and `newEngine=true`;
- deep research uses deep/null round, source, and Reader budgets/critique and revision. Null removes the plugin count ceiling; explicit numeric budgets and explicit quick/standard depth take precedence.

There is no known documented task-wide API maximum for rounds, sources, or Reader calls. These are plugin orchestration concepts. Account quota, rate limits, and explicit task budgets still apply. The optional pipeline stops when its planner returns an empty array, repeats previous queries, or a round adds no new sources; invalid follow-up plans stop expansion and appear in diagnostics. With no Reader count ceiling, it selects useful pages in prompt-sized batches instead of reading every hit. Query batches, concurrent requests, and prompt/excerpt windows are implementation bounds rather than API maxima. Use direct host-driven tools and topic-level evidence summaries for research beyond a single synthesis window.

Explicit call arguments take precedence. Raw content remains explicit.

The first successful research-capable call while the profile is disabled emits a one-time `pluginNotice`. Include it in that same answer to the user.

## Local resource catalog and state recovery

The reviewed API does not provide a general list-files endpoint for Open topics. The plugin records returned topic IDs, directory-root IDs, topic file IDs, and Book file IDs locally. `metaso_resource_catalog` can recover only resources created through this plugin. Never guess an ID for deletion.

Malformed settings JSON is moved aside with a `.corrupt-<timestamp>` suffix before defaults are restored. Capabilities and Research Frontier status expose the recovery warning. API mutations remain successful even if a later local catalog update fails; the tool result then includes `catalogWarning` so callers do not retry and accidentally duplicate the remote mutation.

Uploads likewise remain successful if optional readiness polling later fails. In that case the result preserves `fileIds`, sets `readinessError`, and instructs the caller to check those IDs with `metaso_file_status` instead of repeating the upload.

## Deep-research validation

The optional bounded pipeline high-cost gate uses an estimated upper bound based on planner rounds, planned search calls, Reader calls, synthesis/critique, and a possible citation repair. A standard label does not bypass the gate when custom limits are large.

After synthesis, every `[S#]` marker is checked against the returned source registry. Missing or unknown IDs trigger one repair pass. If validation still fails, the report is prefixed with a warning and `diagnostics.citationValidation.valid` remains false. Semantic support is additionally reviewed by the model in deep mode, but deterministic validation proves only citation-ID integrity.

Native MetaSo `[[n]]` markers are resolved against that answer response's source array and converted to stable registry IDs. Unmapped native markers fail validation. The registry never exceeds `max_sources`, including sources introduced by synthesis or repair. English, Simplified Chinese, Japanese, and Korean receive deterministic script-ratio checks and locale-specific fallback queries. Other languages use neutral fallback queries and are explicitly reported as unchecked rather than being overclaimed as validated.

## Official remote MCP alternative

The bundled server keeps using REST to expose the full parameter set and preserve local topic/research tools. No additional remote connection is required. Official endpoint: `https://metaso.cn/api/mcp`, authenticated with an `Authorization: Bearer <API key>` header. Never store an actual key in documentation.

The supplied official MCP guide lists `metaso_web_search` (`q`, `scope`, `includeSummary`, `includeRawContent`, `size`), `metaso_web_reader` (`url`, `format: json|markdown`), and `metaso_chat` (`message`, `model`). Its search scholarly scope is `paper`; REST is `scholar`. Do not assume remote MCP exposes every REST option; inspect its advertised schema when connecting.

API reference checked 2026-09-16: https://metaso.cn/search-api/playground . The user's supplied API examples provide the detailed options; the attached result.json is response-shape evidence only, not verified factual content.
