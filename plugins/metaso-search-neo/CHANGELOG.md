## 2026-09-16 GitHub Marketplace packaging

- Place the plugin under `plugins/metaso-search-neo/` and add the repository marketplace catalog at `.agents/plugins/marketplace.json`.
- Publish installation and upgrade commands in the repository README while keeping the tested Codex MCP configuration intact.

## 2026-09-16 Frontier resource policy

- Frontier searches use the API guide's maximum size 100; cumulative round/source/Reader ceilings are removed using null budgets.
- Add evidence-driven stopping, query reuse, selective Reader verification, and explicit resource-policy diagnostics.
- Distinguish API limits and account quotas from local orchestration bounds; teach the skills to expand only while evidence quality benefits.

## 2026-09-16 API and skill architecture update

- Split into five focused skills with distinct discovery names.
- Make host-driven research the primary skill workflow; keep bounded orchestration optional.

- Expose official search/answer parameter names; retire legacy aliases.
- Accept page strings and document recommended sizes, partial result counts, and snippet/summary semantics.
- Use messages and omitted default format/webpage scope for chat completions.
- Preserve citations across SSE chunks, reject stream errors, and accept JSON fallback responses.
- Document reasoning/latency model choices and the official remote MCP alternative.

# Changelog

## 0.2.0 — 2026-09-03

- Preserve large MetaSo identifiers as exact strings so native and topic session follow-ups work.
- Stream thinking models internally to prevent reasoning-trace leakage from non-stream answers.
- Compact SSE results by removing raw event duplication and deduplicating citations and highlights.
- Raise the default per-request timeout from 60 to 120 seconds for thinking-model research calls.
- Normalize native `[[n]]` citations into the deep-research `[S#]` registry and reject unmapped markers.
- Enforce `max_sources` across search, synthesis, and citation-repair sources.
- Make fallback queries language-aware and validate English output before accepting a report.
- Add named macOS Login Keychain credential profiles and a verified import/selection script.
- Use the `cc.jasonstu` Keychain namespace with selected-profile compatibility for the pre-release namespace, safe non-overwriting rotation, and truthful deletion failures.
- Validate output script ratios for English, Simplified Chinese, Japanese, and Korean, with locale-specific fallback queries.
- Document observed upstream topic literal-date and Bookshelf metadata limitations.

## 0.1.0 — 2026-08-21

- Initial open-source release.
