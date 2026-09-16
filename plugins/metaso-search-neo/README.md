# MetaSo Search Neo for Codex

This Codex Plugin packages a dependency-free local MCP server and five focused skills around MetaSo's public and Open APIs.

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

Version 0.2 preserves every API identifier as an exact string, including Open API session IDs larger than JavaScript's safe-integer limit. Thinking-model answers are streamed internally even for non-stream callers so MetaSo reasoning traces cannot leak through the public result. Aggregated streams omit duplicate raw events and deduplicate repeated citations and highlights.

## Authentication

Provide the API key at runtime through the `METASO_API_KEY` environment variable or the Codex secret mechanism. Do not write a key into this plugin, `.mcp.json`, source files, or logs.

For the bundled MCP shown under **From plugins** in Codex Desktop on macOS, run `./scripts/import-metaso-key.command`. It prompts for a credential name and optional Keychain comment, then lets macOS Keychain collect and confirm the hidden Key directly. The script validates the stored value and deletes malformed entries. The MCP reads the selected named credential directly from Keychain each time it starts, so the Key is not injected into the user-wide launchd environment. Use `--list`, `--use NAME`, `--status`, and `--clear [NAME]` to organize and switch credentials. Do not put the Key under `[shell_environment_policy.set]`; that shell policy is not reliably forwarded to bundled plugin MCP servers. See [QUICKSTART.md](QUICKSTART.md) for migration and standalone-server instructions.

The importer deliberately refuses to overwrite an existing valid name. Rotate safely by importing a new name, switching with `--use`, verifying it, and then clearing the old name. Version 0.2 can read a selected named credential stored under the pre-release service namespace and clears both service namespaces, but it never silently activates the old unnamed `METASO_API_KEY` Keychain account.

Keychain storage prevents passive exposure through configuration files, shell history, and ordinary logs; it is not an isolation boundary against a hostile process running as the same macOS login. Retrieval is delegated to the system `/usr/bin/security` executable, so another same-user process that knows the service and profile names may also be able to read the item.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `METASO_BASE_URL` | `https://metaso.cn` | Override the API origin, primarily for tests |
| `METASO_TIMEOUT_MS` | `120000` | Per-request timeout |
| `METASO_MAX_UPLOAD_BYTES` | `52428800` | Maximum local file size |
| `METASO_STATE_DIR` | Codex state directory | Override persistent plugin settings location |
| `METASO_KEY_PROFILE_DIR` | Plugin state directory | Override non-secret Keychain profile metadata location; must be absolute |
| `METASO_DISABLE_KEYCHAIN` | `false` | Disable the macOS Keychain fallback when set to `true` |
| `METASO_ALLOW_PRIVATE_URLS` | `false` | Test-only escape hatch for private Reader URLs |

The plugin never reads another MCP server's process environment. Explicit `METASO_API_KEY` environment configuration remains available for standalone MCP and CI use and takes precedence over Keychain. Otherwise, the macOS bundled plugin reads the selected Keychain credential at process startup.

## Research Frontier

**Research Frontier** is a plugin-global persistent profile. It is off by default. On the first successful research-capable API call, the result includes a one-time notice explaining how to enable it.

When enabled, later calls use higher defaults where the caller did not already choose values:

- search defaults to `size=100`, the maximum in the supplied API guide (returned counts can be lower);
- answer defaults to `fast_thinking`;
- native research enables `enableMix` and `newEngine`;
- deep research uses `null` round/source/Reader budgets: no plugin count ceiling, with evidence-driven stopping and selective Reader verification;
- explicit numeric task budgets and quick/standard depth overrides still take precedence.

No documented task-wide API maximum is known. Account quotas, API rate limits, and user budgets still apply. The host model expands research only for material evidence gaps, reuses results, and stops low-value or duplicate calls. Null budgets do not mean spending until credits run out. The optional pipeline's concurrency and prompt/excerpt windows are implementation bounds, not API resource limits; large tasks should use host-driven topic batches.

It does not automatically enable `includeRawContent`; raw webpage retrieval remains explicit.

Use the `metaso_research_frontier` MCP tool with `status`, `enable`, or `disable`.

## Resource catalog

MetaSo's reviewed Open API does not expose a general topic-file listing endpoint. The plugin therefore records IDs returned by its own topic, upload, and bookshelf operations in the same private state directory. Use `metaso_resource_catalog` to recover exact IDs before status checks or deletion. It cannot discover resources created outside this plugin.

If an upload succeeds but optional readiness polling fails, the returned file IDs are retained in `readinessError`; check them with `metaso_file_status` rather than uploading the same content again.

Deep-research configurations are cost-gated by a conservative estimated call ceiling, not only by the visible depth label. Generated reports receive deterministic citation-ID validation; one repair pass runs when citations are missing or reference unknown IDs, and unresolved problems are surfaced in the report and diagnostics.

The deep-research source registry strictly honors `max_sources`. Native MetaSo `[[n]]` citations are mapped by URL to stable `[S#]` registry entries before validation, and unmapped native markers prevent a false-positive validation result. English, Simplified Chinese, Japanese, and Korean receive deterministic script-ratio checks and one combined repair attempt; other languages are explicitly reported as unchecked.

## Upstream API limitations

- Topic answers are generated text rather than byte-exact extraction. Live testing observed MetaSo changing the literal date `2042-03-14` to `2042-03-13` despite a quote-verbatim instruction; inspect returned highlights or the source file for exact literals.
- Bookshelf URL imports can parse successfully while MetaSo returns generic metadata such as `无标题` and `本地文件`. The plugin preserves that upstream metadata and uses the returned `fileId` for status and deletion.

## Development

Requires Node.js 20 or later and no npm dependencies.

```bash
npm run check
npm test
npm run smoke
```

The official MetaSo favicon is included as `assets/favicon.ico`; `assets/metaso-icon.png` is a 128×128 conversion used by the Codex UI. MetaSo names and artwork remain the property of their respective owner and are not covered by this repository's MIT license.

## Focused skills

- **MetaSo Search** (`$metaso-search-neo`): Search web, academic, and media sources.
- **MetaSo Reader** (`$metaso-reader`): Extract a webpage as Markdown or JSON.
- **MetaSo Answer** (`$metaso-answer`): Answer questions with retrieval and citations.
- **MetaSo Deep Research** (`$metaso-deep-research`): Plan and verify multi-source research reports.
- **MetaSo Knowledge Base** (`$metaso-knowledge-base`): Upload and search topic files and manage resources.

The public API tools accept official camelCase flags. Search uses `q` and string page values. Answer defaults to OpenAI-compatible messages and chat_completions; request simple format explicitly.
