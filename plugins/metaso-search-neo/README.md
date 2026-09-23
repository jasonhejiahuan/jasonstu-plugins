# MetaSo Search Neo for Codex

This Codex Plugin packages a dependency-free local MCP server and six focused skills around MetaSo's public and Open APIs. Optional browser account setup installs Playwright only when invoked.

Distributed in the [JASON Studio Plugins marketplace](https://github.com/jasonhejiahuan/jasonstu-plugins). The marketplace ID is `jasonstu-plugins`; the plugin ID remains `metaso-search-neo`.

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
- Local browser setup with `metaso_auth_start`, `metaso_auth_status`, and `metaso_auth_cancel`; the Key stays in the local process and private credential file.

Version 0.3.0 adds cross-platform credential-file storage and an optional browser workflow for creating or importing a named API Key. Live login, direct website-API creation, private-file storage and a subsequent search were verified on macOS; see [authentication details and verification limits](docs/auth.md).

Version 0.2 preserves every API identifier as an exact string, including Open API session IDs larger than JavaScript's safe-integer limit. Thinking-model answers are streamed internally even for non-stream callers so MetaSo reasoning traces cannot leak through the public result. Aggregated streams omit duplicate raw events and deduplicate repeated citations and highlights.

## Authentication

Use the **MetaSo Auth** skill (`$metaso-auth`) or ask Codex to connect your MetaSo account. The optional local helper opens an isolated browser at the [MetaSo API Key page](https://metaso.cn/search-api/api-keys). Complete login yourself. It then uses same-origin JavaScript requests in that authenticated browser to create a uniquely named Key or import an existing exact name from the JSON response, and saves it locally without returning the secret through MCP or chat. It does not click form controls or read table/input elements. These are MetaSo's internal website endpoints, not an official stable provisioning API. It never regenerates or deletes MetaSo Keys. Ambiguous creation results stop for inspection instead of automatically resubmitting. See [website request evidence](docs/auth.md#website-request-contract-and-evidence).

From the plugin directory, the equivalent CLI is `node scripts/auth.mjs`; use `--name NAME`, `--import-existing --name NAME`, `--replace`, or `--status` as needed. Existing file credentials require explicit replacement. A `--stdin` mode imports a Key from redirected local input without putting it in command arguments. See [QUICKSTART.md](QUICKSTART.md) for examples.

First browser setup requires npm and installs pinned `playwright@1.63.0` under the credential directory's `browser-runtime/1.63.0`. It tries installed Chrome/Edge before downloading Chromium to Playwright's normal OS cache. Browser setup needs a graphical desktop; normal API use does not need Playwright. [Playwright browser documentation](https://playwright.dev/docs/browsers)

The Key is stored in `credential.json` under `METASO_CREDENTIALS_DIR`, else explicitly provided `PLUGIN_DATA/credentials`, else `CODEX_HOME/state/metaso-search-neo/credentials` (default `~/.codex/state/metaso-search-neo/credentials`). Overrides must be absolute paths. The file is **plaintext, not encrypted**: POSIX permissions are restricted to the current user (`0700` directory, `0600` file); Windows uses a current-user ACL and stops if it cannot enforce it. Do not place this directory in a repository, plugin cache, or shared/synced folder.

Credential priority is explicit client key → `METASO_API_KEY` → plugin credential file → selected legacy macOS Keychain credential. File setup does not delete or migrate Keychain items; existing users can keep their current configuration. File-backed and fallback clients reload credentials on the next capability/API call, so a successful local connection needs no MCP restart. An explicit environment Key continues to override the file.

This local setup is not native OAuth, a Codex-managed secret vault, or an automatic install hook. `ON_INSTALL` is marketplace authentication timing metadata and does not invoke this helper. Official `PLUGIN_DATA` injection is documented for plugin hooks, so bundled stdio MCP must not assume it is present. See the [OpenAI package contract](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks), [OAuth authentication contract](https://developers.openai.com/plugins/build/auth), and [local configuration guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin#replace-claude-userconfig).

Do not write a Key into this plugin, `.mcp.json`, source files, chat, command arguments, or logs. Do not rely on `[shell_environment_policy.set]` to forward it to a bundled MCP server.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `METASO_BASE_URL` | `https://metaso.cn` | Override the API origin, primarily for tests |
| `METASO_TIMEOUT_MS` | `120000` | Per-request timeout |
| `METASO_MAX_UPLOAD_BYTES` | `52428800` | Maximum local file size |
| `METASO_STATE_DIR` | Codex state directory | Override persistent plugin settings location |
| `METASO_CREDENTIALS_DIR` | See precedence above | Override private credential-file directory; must be absolute |
| `PLUGIN_DATA` | Not assumed for stdio MCP | If explicitly provided, use its `credentials` subdirectory |
| `METASO_KEY_PROFILE_DIR` | Plugin state directory | Override non-secret Keychain profile metadata location; must be absolute |
| `METASO_DISABLE_KEYCHAIN` | `false` | Disable the macOS Keychain fallback when set to `true` |
| `METASO_ALLOW_PRIVATE_URLS` | `false` | Test-only escape hatch for private Reader URLs |

The plugin never reads another MCP server's process environment. Explicit `METASO_API_KEY` configuration remains available for standalone MCP and CI use. The optional legacy macOS importer is still `./scripts/import-metaso-key.command`; its `--list`, `--use NAME`, and `--status` commands manage existing named Keychain profiles.

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

Requires Node.js 20 or later. The core MCP server has no npm dependencies; optional browser setup installs pinned Playwright support separately.

```bash
npm run check
npm test
npm run smoke
```

The official MetaSo favicon is included as `assets/favicon.ico`; `assets/metaso-icon.png` is a 128×128 conversion used by the Codex UI. MetaSo names and artwork remain the property of their respective owner and are not covered by this repository's MIT license.

## Focused skills

- **MetaSo Auth** (`$metaso-auth`): Connect through local browser setup, inspect status, or cancel setup without exposing the Key.
- **MetaSo Search** (`$metaso-search-neo`): Search web, academic, and media sources.
- **MetaSo Reader** (`$metaso-reader`): Extract a webpage as Markdown or JSON.
- **MetaSo Answer** (`$metaso-answer`): Answer questions with retrieval and citations.
- **MetaSo Deep Research** (`$metaso-deep-research`): Plan and verify multi-source research reports.
- **MetaSo Knowledge Base** (`$metaso-knowledge-base`): Upload and search topic files and manage resources.

The public API tools accept official camelCase flags. Search uses `q` and string page values. Answer defaults to OpenAI-compatible messages and chat_completions; request simple format explicitly.
