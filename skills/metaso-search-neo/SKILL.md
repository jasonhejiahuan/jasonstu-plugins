---
name: metaso-search-neo
description: Use MetaSo to search current web, document, scholarly, image, video, or podcast sources; read webpages; produce cited answers or bounded deep-research reports; and work with MetaSo topic knowledge bases. Use when the user asks to search with MetaSo, verify current claims, conduct multi-source research, or query uploaded topic files.
---

# MetaSo Search Neo

Use the bundled `metaso-search-neo` MCP tools. Prefer direct REST-backed tools over MetaSo's remote MCP because the REST schemas and error handling are normalized here.

## Route the request

- For a direct lookup or source list, use `metaso_search`.
- To inspect a known page, use `metaso_read_url`.
- For a concise cited answer, use `metaso_answer` with an explicit model.
- For one native MetaSo research turn or a session follow-up, use `metaso_research`.
- For a multi-source report, evidence comparison, literature scan, or explicit deep-research request, use `metaso_deep_research`.
- For user-provided files, create/upload/wait/search with the topic tools. Preserve both topic `id` and `dirRootId`; search uses the topic ID and upload uses the directory-root ID.

Do not invoke deep research for a simple fact when one search or answer call is sufficient.

## Research depth

- `quick`: narrow reconnaissance with a small source set.
- `standard`: default for ordinary research; includes iterative gap search and Reader evidence.
- `deep`: use when the user explicitly asks for deep, exhaustive, multi-angle, or high-confidence research. Set `allow_high_cost=true` because that request supplies the cost authorization required by the tool.

If the plugin-global **Research Frontier** profile is enabled, respect its higher defaults. Do not enable it silently. The first successful research-capable result may contain `pluginNotice`; explicitly surface that notice in the same user-facing answer so the user learns that Research Frontier is available. The notice is one-time and must not replace or delay the requested result.

## Evidence behavior

- Keep source links near supported claims.
- Distinguish source text, inference, conflicts, and missing evidence.
- Do not claim that search rank or `score: high` independently proves truth.
- If deep-research diagnostics show failed searches or Reader calls, disclose material gaps. Supplement with targeted search/read calls only when needed.
- Check `diagnostics.citationValidation`; do not present a report as fully sourced when validation remains false.
- Treat API `credits` as per-call cost and Open API `balance` as remaining balance; do not merge them.
- Leave raw-content retrieval off unless full indexed text is useful; Research Frontier does not override this.

## Stateful and destructive operations

Wait until uploaded files reach progress 100 before topic search. Use returned `fileId` rather than Book `id` for bookshelf progress and deletion.

Delete files or topics only when the user clearly requested deletion and exact IDs are known. If an ID from an earlier upload is no longer in context, use `metaso_resource_catalog`; it contains only resources previously created through this plugin. If the resource is absent there, stop and request its exact ID. Report what was deleted and verify a material cleanup when appropriate.

For endpoint behavior, encodings, error semantics, and troubleshooting, read [references/api-behavior.md](references/api-behavior.md).
