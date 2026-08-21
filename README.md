# MetaSo Search Neo for Codex

This Codex Plugin packages a dependency-free local MCP server and a research Skill around MetaSo's public and Open APIs.

First-time setup: see [QUICKSTART.md](QUICKSTART.md) for API Key configuration and verification.

## Capabilities

- Six-scope structured search: webpage, document, scholar, image, video, and podcast.
- Webpage Reader with Markdown or structured JSON output.
- Cited answers with explicit MetaSo models and aggregated SSE support.
- Native Open/SDK research, session follow-ups, topic search, and highlights.
- Bounded multi-round deep research with planning, gap search, Reader evidence, citations, and optional critique/revision.
- Topic creation, local file/directory upload, parse-status polling, search, and deletion.
- Bookshelf import from local files or public URLs.
- A plugin-local resource catalog that preserves IDs for topics and files created through this plugin.
- Plugin-global **Research Frontier** mode, disabled by default.

## Authentication

Provide the API key at runtime through the `METASO_API_KEY` environment variable or the Codex secret mechanism. Do not write a key into this plugin, `.mcp.json`, source files, or logs.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `METASO_BASE_URL` | `https://metaso.cn` | Override the API origin, primarily for tests |
| `METASO_TIMEOUT_MS` | `60000` | Per-request timeout |
| `METASO_MAX_UPLOAD_BYTES` | `52428800` | Maximum local file size |
| `METASO_STATE_DIR` | Codex state directory | Override persistent plugin settings location |
| `METASO_ALLOW_PRIVATE_URLS` | `false` | Test-only escape hatch for private Reader URLs |

The plugin never reads another MCP server's process environment. Codex explicitly passes the listed variables to this server.

## Research Frontier

**Research Frontier** is a plugin-global persistent profile. It is off by default. On the first successful research-capable API call, the result includes a one-time notice explaining how to enable it.

When enabled, later calls use higher defaults where the caller did not already choose values:

- search defaults to 20 results;
- answer defaults to `fast_thinking`;
- native research enables `enableMix` and `newEngine`;
- deep research defaults to deep, 3 rounds, up to 48 sources, 12 Reader fetches, and critique/revision.

It does not automatically enable `include_raw_content`; raw webpage retrieval remains explicit.

Use the `metaso_research_frontier` MCP tool with `status`, `enable`, or `disable`.

## Resource catalog

MetaSo's reviewed Open API does not expose a general topic-file listing endpoint. The plugin therefore records IDs returned by its own topic, upload, and bookshelf operations in the same private state directory. Use `metaso_resource_catalog` to recover exact IDs before status checks or deletion. It cannot discover resources created outside this plugin.

If an upload succeeds but optional readiness polling fails, the returned file IDs are retained in `readinessError`; check them with `metaso_file_status` rather than uploading the same content again.

Deep-research configurations are cost-gated by a conservative estimated call ceiling, not only by the visible depth label. Generated reports receive deterministic citation-ID validation; one repair pass runs when citations are missing or reference unknown IDs, and unresolved problems are surfaced in the report and diagnostics.

## Development

Requires Node.js 20 or later and no npm dependencies.

```bash
npm run check
npm test
npm run smoke
```

The official MetaSo favicon is included as `assets/favicon.ico`; `assets/metaso-icon.png` is a 128×128 conversion used by the Codex UI. MetaSo names and artwork remain the property of their respective owner and are not covered by this repository's MIT license.
