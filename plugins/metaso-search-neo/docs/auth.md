# Local MetaSo connection setup

Version 0.3.0 adds an optional local browser workflow and persistent credential file. It keeps the core MCP server dependency-free and does not require a hosted credential service. This is a plugin-implemented setup tool, not a Codex OAuth connection or encrypted secret vault.

## Contract and scope

The marketplace's `policy.authentication` controls authentication timing. It does not register a custom callback that runs `scripts/auth.mjs`, and `ON_INSTALL` does not start this plugin's local browser helper. Users explicitly invoke the MetaSo Auth skill, `metaso_auth_start`, or the CLI. [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

OpenAI's remote MCP connection contract uses OAuth 2.1, an authorization server and protected-resource metadata. This local stdio integration does not implement that remote contract. OpenAI's migration guide also distinguishes documented local configuration from remote OAuth and does not support Claude `userConfig` install prompts. [Authentication contract](https://developers.openai.com/plugins/build/auth), [local configuration guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin#replace-claude-userconfig)

The new sixth skill, `metaso-auth`, guides these explicit tools:

| Tool | Behavior |
|---|---|
| `metaso_auth_start` | Begin visible browser setup; optional `name`, `mode: "create"` or `"import"`, `replace`, and `timeout_seconds` |
| `metaso_auth_status` | Return setup state, nonsecret credential metadata and whether `METASO_API_KEY` overrides the file |
| `metaso_auth_cancel` | Cancel the active local session and close its browser; do not revoke a Key that may already exist |

The default timeout is 600 seconds; callers may choose 30–900 seconds. Starting setup does not mean login has completed. Only `complete` means the helper saved the selected Key; a successful API request is still needed to confirm upstream access.

## Browser-session request workflow

1. Open an isolated, visible browser at `https://metaso.cn/search-api/api-keys`.
2. Let the user handle login, CAPTCHA, SMS or QR authentication. Website session requests provide the token header in memory; a successful API-Key list response confirms login readiness. The helper does not extract cookies or inspect page elements to determine authentication.
3. Use same-origin `fetch` in that browser context, with browser-managed credentials and the session token header, to list API Keys. In create mode, require a unique name and submit the website's create request once. The default name includes a short date and random suffix.
4. In import mode, skip creation and select the existing exact name from the JSON list. Require a unique matching record and validate the returned Key. No DOM selectors, table reads, input reads or button clicks are used for Key provisioning.
5. Validate the Key, save it in the private credential file, and close the browser.

MetaSo's create dialog limits names to 20 characters. The helper conservatively enforces 20 UTF-16 code units after trimming (JavaScript string length, so some emoji count as two); control/format characters and API-Key-shaped text are rejected. Default names such as `Codex-260923-a1b2c3` fit this limit. Existing matching names in create mode and duplicate matches in either mode stop setup. A submission with an uncertain outcome is not retried automatically: inspect the website and import the exact name if it was created. No existing Key is regenerated or deleted.

The browser uses an ephemeral context, so it does not reuse the user's ordinary browser login. It does not save a profile or `storageState`, enable tracing/video/HAR/screenshots, or forward page console logs. The website session token stays in memory and is not saved with the API Key. Tool outputs contain state, name and storage metadata, never the Key or the raw response containing it.

## Website request contract and evidence

The first-party website JavaScript inspected on 2026-09-23 exposes these operations:

| Purpose | Website request | Relevant raw response |
|---|---|---|
| List API Keys | `GET /api/get_api_keys` | `data.apiKeys`, containing records with `name`, `sensitiveId` and `createdAt` |
| Create a Key | `POST /api/edit_api_key` with JSON `{ "action": "create", "name": "<chosen name>" }` | `data`, containing the created record |

The request definitions are visible in [MetaSo's first-party shared JavaScript](https://static-1.metaso.cn/_next/static/chunks/84578-7c7801c66ded2f9c.js); the JSON record use is visible in the [API Key page JavaScript](https://static-1.metaso.cn/_next/static/chunks/app/%28pages%29/%28menu-attached%29/search-api/api-keys/page-deb5cc62837b1b10.js). The shared client uses a session `token` header and credentialed website requests. The helper observes the browser's own session header in memory and makes same-origin requests with `credentials: "include"`; it does not read or export browser cookie values. An unauthenticated live list request returned business error `errCode: 401`; this is treated as not logged in, not as a usable Key list.

These are internal website endpoints discovered from public first-party code. They are not part of a documented stable MetaSo provisioning API or an OAuth delegation flow; paths, headers, names and response shapes can change. A live authenticated run on 2026-09-23 verified the current create-and-confirm contract. The helper validates response shapes and fails closed when the contract is not met, without blindly retrying a potentially completed create request. The user-observed create form also established the 20-character name limit used by both browser setup and local storage.

## Browser dependencies

Node.js 20+, npm, network access and a graphical desktop are required for browser setup. On first invocation, the helper installs pinned `playwright@1.63.0` into `<credential-directory>/browser-runtime/1.63.0`, outside the plugin's installation cache. It first tries installed Chrome and Edge (Edge first on Windows). If neither can be launched, it downloads Playwright Chromium into the normal Playwright OS cache. A headless server or desktop policy may still prevent launching; manual import remains available. Normal MetaSo API calls do not require Playwright.

Playwright's normal browser cache is `~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux, and `%USERPROFILE%\AppData\Local\ms-playwright` on Windows. Browser downloads can occupy hundreds of megabytes. [Playwright browser documentation](https://playwright.dev/docs/browsers)

## Credential storage

The file is `credential.json` in the first applicable directory below:

| Configuration | Credential directory |
|---|---|
| Absolute `METASO_CREDENTIALS_DIR` | The specified directory |
| Explicitly provided absolute `PLUGIN_DATA` | `<PLUGIN_DATA>/credentials` |
| Absolute `CODEX_HOME` | `<CODEX_HOME>/state/metaso-search-neo/credentials` |
| No override | `~/.codex/state/metaso-search-neo/credentials` |

Relative overrides are rejected. The official `PLUGIN_DATA` environment variable is documented for plugin hook commands; its presence is not guaranteed for this bundled stdio MCP. The fallback is therefore intentional. This directory convention is implemented by this plugin and is not a promise of Codex-managed secret storage. [Plugin hooks and data directory contract](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

The JSON file contains the API Key, display name and creation timestamp in **plaintext**. POSIX uses a current-user-owned `0700` directory and `0600` file. Windows restricts ACLs to the current account and stops when it cannot establish or verify private storage. Symlink paths, multiply linked credential files, unexpected file types and unsafe permissions are rejected. Writes use an exclusive lock and atomic publication; overwriting a credential requires `replace: true` or `--replace`.

These filesystem controls protect against access by other ordinary accounts; they do not encrypt data or isolate it from processes running as the same user. Avoid repository directories, plugin caches, shared/synced folders, and backups accessible to others. `metaso_auth_status` and `--status` report the effective path and `encrypted: false` without returning the Key.

## Priority and compatibility

The client chooses an explicit constructor Key, then `METASO_API_KEY`, then the plugin credential file, then a selected legacy macOS Keychain credential. Environment configuration continues to work for standalone MCP and CI. The file is re-read before capability and API calls for file/missing/legacy sources, allowing setup and rotation without restarting the MCP process. Each in-flight request keeps the Key selected when that request started.

The browser flow does not copy, delete or migrate Keychain items. `scripts/import-metaso-key.command` remains available as a macOS-only legacy option; `METASO_DISABLE_KEYCHAIN=true` disables that fallback. Installing new tools or skills can still require restarting Codex and opening a new task. Do not depend on the agent-shell setting `[shell_environment_policy.set]` to forward secrets to a bundled plugin MCP.

## Interrupted setup and writes

A killed setup process can leave `.browser-auth-lock` with nonsecret ownership metadata. A stale or ambiguous lock fails closed. Confirm that the recorded process and all other MetaSo setup processes have exited before removing only that lock directory. Never remove a lock while setup is active. A broken optional browser-runtime install is moved to an `.incomplete-<random>` sibling before one clean reinstall; the plugin does not silently delete it.

A process killed during the short credential-write transaction can leave `.write-lock` in the credential directory. The plugin deliberately does not guess that this lock is stale. Close all MetaSo setup processes and confirm that no writer is active before inspecting and removing only this empty lock directory; never clear the whole credential directory to recover a lock.

First-time publication uses a no-clobber hard link followed by removal of its private `.credential-<random>.tmp` alias. A crash between those operations can leave both names referring to the same file; reads then fail closed because the credential has multiple links. After confirming no writer is active, inspect owner, permissions, file IDs and link counts without printing file contents. Remove only a verified private temporary alias that refers to the same file as `credential.json`; preserve `credential.json`. If the relationship is uncertain, stop and investigate instead of deleting files or weakening permissions. An unpublished temporary file can also contain a Key and must be treated as secret data during recovery.

## Command-line setup

Run one appropriate command from the plugin directory:

```bash
node scripts/auth.mjs
node scripts/auth.mjs --name "Codex personal"
node scripts/auth.mjs --import-existing --name "Codex personal"
node scripts/auth.mjs --import-existing --name "Codex replacement" --replace
node scripts/auth.mjs --status
```

`--replace` changes the locally selected credential only; it does not revoke the old MetaSo Key. Ctrl+C cancels an active CLI session. Cancellation after submission may leave a newly created Key on MetaSo, so inspect the named row before retrying.

## Manual import

`--stdin` accepts a Key from redirected local input; it refuses an interactive terminal. Never place the actual Key in arguments, shell history, chat, MCP tool inputs, or tracked files. Copy a Key from the MetaSo website, then run the applicable command:

```bash
# macOS
pbpaste | node scripts/auth.mjs --stdin --name "Codex personal"

# Linux Wayland, if wl-clipboard is installed
wl-paste --no-newline | node scripts/auth.mjs --stdin --name "Codex personal"
```

```powershell
# Windows PowerShell
Get-Clipboard -Raw | node scripts/auth.mjs --stdin --name "Codex personal"
```

Add `--replace` only to replace an existing local credential. Clear the clipboard after import. Clipboard managers are separate from this plugin and may retain clipboard history.

## Verification limits

On 2026-09-23, a live macOS run completed user login, one direct create request, exact-name confirmation and private-file storage. A subsequent public MetaSo search used that saved file credential, returned 10 results and consumed 3 credits. The credential directory and file were verified as `0700` and `0600`; no Key value was included in test output.

Storage and client tests cover permission rejection, symlinks/hardlinks, no-clobber concurrent writes, explicit replacement, credential priority, live reload and secret-free status/errors. Website-request fixtures cover late login, duplicate/import cases, one-POST recovery, response validation, cancellation and origin restrictions without DOM selectors. These fixtures are distinct from the live test above. CI separately exercises portable storage/client tests on macOS, Linux and Windows; mocked ACL-command tests alone do not establish native Windows behavior. Real-account browser setup has only been verified on macOS, not Windows or Linux.
