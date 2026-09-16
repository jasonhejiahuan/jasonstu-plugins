# JASON Studio Plugins

This repository is a Codex plugin marketplace maintained by JASON Studio. It contains [MetaSo Search Neo](plugins/metaso-search-neo/README.md), a local MCP server and five focused skills for search, webpage reading, cited answers, deep research, and topic knowledge bases.

## Install from GitHub

Use Codex CLI to add this repository as a marketplace, then install the plugin:

```bash
codex plugin marketplace add jasonhejiahuan/jasonstu-plugins
codex plugin add metaso-search-neo@jasonstu-plugins
```

The marketplace catalog is [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json). The plugin package is under [`plugins/metaso-search-neo/`](plugins/metaso-search-neo/). The marketplace source path is relative to the repository root, so a GitHub clone or marketplace refresh loads the same package.

Requires Node.js 20 or later. Each user supplies their own MetaSo API key. On macOS, follow the plugin's [quick start](plugins/metaso-search-neo/QUICKSTART.md) to import the key into Keychain. Do not put API keys in repository files or marketplace metadata.

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
