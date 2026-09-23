# JASON Studio Plugins

This repository is a Codex plugin marketplace maintained by JASON Studio. It contains [MetaSo Search Neo](plugins/metaso-search-neo/README.md), a local MCP server and six focused skills for account setup, search, webpage reading, cited answers, deep research, and topic knowledge bases.

## Install from GitHub

Use Codex CLI to add this repository as a marketplace, then install the plugin:

```bash
codex plugin marketplace add jasonhejiahuan/jasonstu-plugins
codex plugin add metaso-search-neo@jasonstu-plugins
```

The marketplace catalog is [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json). The plugin package is under [`plugins/metaso-search-neo/`](plugins/metaso-search-neo/). The marketplace source path is relative to the repository root, so a GitHub clone or marketplace refresh loads the same package.

Requires Node.js 20 or later. Version 0.3.0 adds optional browser setup: ask Codex to connect MetaSo, complete login in the browser, and the local helper calls MetaSo's website requests to create or import the exact named API Key. It does not automate form controls or read the Key from page elements. Credentials are stored in a private, persistent file outside the plugin bundle. This file is plaintext with current-user permissions, not an encrypted vault. Environment-variable configuration and the legacy macOS Keychain fallback remain available. See the [quick start](plugins/metaso-search-neo/QUICKSTART.md) and [authentication details](plugins/metaso-search-neo/docs/auth.md).

Browser setup requires npm and a desktop session. On first use it installs pinned Playwright support and, if Chrome/Edge cannot be launched, downloads Chromium. It is an explicit local setup workflow; the marketplace's `ON_INSTALL` policy does not launch it automatically. Live login, direct website-API Key creation, private-file storage and a subsequent search were verified on macOS. Do not put API keys in repository files, marketplace metadata, or chat.

To update an installed marketplace and plugin after a release:

```bash
codex plugin marketplace upgrade jasonstu-plugins
codex plugin add metaso-search-neo@jasonstu-plugins
```

Restart Codex and start a new task to load newly installed skills and MCP tools.

This GitHub marketplace is a repository distribution source. It does not itself publish the plugin to the universal public Plugins Directory.

## Development

```bash
cd plugins/metaso-search-neo
npm run check
npm test
npm run smoke
```

See the plugin [README](plugins/metaso-search-neo/README.md) for its features, authentication, and Research Frontier behavior. This repository's code is MIT licensed; MetaSo's names and artwork remain the property of their respective owner.
