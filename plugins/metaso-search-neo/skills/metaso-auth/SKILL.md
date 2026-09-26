---
name: metaso-auth
description: Connect or reconnect the MetaSo plugin, create a named API Key after interactive login, import an existing named Key, or check local connection progress.
---

# Connect MetaSo

Use `metaso_auth_status` to inspect local connection state. When the user requests connection or setup, call `metaso_auth_start`. It opens an isolated browser on the MCP host; the user completes MetaSo login there. The program creates a unique named Key by default and saves it locally without returning its value. First use may install pinned Playwright and, if Chrome/Edge is unavailable, Chromium.

This is the plugin's local connection workflow, not Codex-native OAuth. It needs a desktop browser on the MCP host. Do not claim that `authentication: ON_INSTALL` invokes it automatically.

Use the user's chosen `name` (at most 20 UTF-16 units), or let the tool generate a short unique name. To recover or import an existing Key, pass `mode: "import"` and its exact name. Set `replace: true` only when replacing the local credential is part of the user's request; it does not revoke the old Key on MetaSo.

Tell the user to finish login in the opened browser. Check `metaso_auth_status` for completion without rapid polling; while waiting, continue independent work or return the pending state. Use `metaso_auth_cancel` when the user cancels. If creation was submitted but completion is uncertain, inspect/import the same name instead of generating another Key.

Never request a Key, password, login code, cookie, or browser storage dump in chat or MCP arguments. Avoid screenshots, DOM dumps, and traces of the API Keys page. The helper uses the website's same-origin create/list requests in the logged-in browser and selects the exact named record from JSON; it does not click buttons or extract a Key from table DOM. These internal website endpoints are not a documented public provisioning API. A saved credential is not proof of successful API authentication; distinguish local setup from an actual successful MetaSo API call.

For command-line/manual fallback and storage details, read [connection setup](../../docs/auth.md).
