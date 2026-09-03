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
