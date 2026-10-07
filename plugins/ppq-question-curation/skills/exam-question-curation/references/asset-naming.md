# Readable attachment names

Every newly packaged `.ppqbank.jstu` must give **every registered attachment** a meaningful, portable filename. Preserve existing PPQ naming: `assets/9702_s25_qp_21.pdf`, `assets/9618_w22_ms_11.pdf`, and figure names carrying the source, role and page. Hash-only names such as `pdf-<sha256>.pdf` and `figure-<sha256>.png` are transport identities, not delivery filenames. Asset IDs and SHA-256 values remain unchanged.

Prefer these names, in order:

1. Keep an already readable, safe asset path. For an opaque path, preserve a meaningful original filename from `meta.sourceAliases`; prefer the alias containing the confirmed course code. Keep official underscores, case, dates and combined-paper notation such as `0450_s03_ms_1+2+4.pdf`.
2. When no meaningful original name is known, use confirmed source fields. Cambridge uses `{code}_{session}_{qp|ms}_{paper}.pdf`, with confirmed February/March → `mYY`, May/June → `sYY`, and October/November → `wYY`. Edexcel keeps original names such as `WAC12_01_0123_QU.pdf` or `4330_IGCSE_Business_msc_20080104.pdf`; otherwise use the exact known series in a compact source name. A publisher's filename date must not be reinterpreted as an exam date.
3. Images use `assets/figures/{code}_{session}_{paper}-{qp|ms}-{page}.png` (or their actual extension), based on original PDF provenance. If a deduplicated image's original parent is absent from this question bank, use its recorded question occurrence and PDF page, choosing deterministically by source ID, role and page. Do not rewrite the image's original provenance. With no source evidence, use a readable question-bank title plus `attachment-001`, `attachment-002`, etc.; never guess a board, year, question number or page.
4. Only a real filename collision adds a short digest suffix; the readable name remains first. Comparison is case insensitive so packages remain portable. Shared published assets with the same path and digest may reuse the existing path across independently owned question banks; distinct records within one package still need distinct paths.

New paths use ASCII letters/numbers, dots, underscores, parentheses, plus signs and hyphens under `assets/`. They exclude traversal, backslashes, Windows reserved filenames and hash-only basenames. This is a new-package convention; legacy platform imports remain compatible with their original names.

## Normalize, validate, then sign

```sh
python3 SKILL_DIR/scripts/normalize_asset_names.py questions.ppqbank.jstu --output questions-named.ppqbank.jstu
python3 SKILL_DIR/scripts/normalize_asset_names.py questions-named.ppqbank.jstu --check
python3 SKILL_DIR/scripts/check_bank_provenance.py questions-named.ppqbank.jstu
python3 SKILL_DIR/scripts/sign_question_bank.py questions-named.ppqbank.jstu
```

The normalizer writes a separate archive. It verifies every attachment's measured digest, updates both `asset.path` and its ZIP entry, and preserves exact attachment bytes, IDs, source/question records, published revisions and unknown metadata. Unchanged JSONL lines retain their original bytes, including BOM, CRLF and Unicode separators. No file is silently dropped: register every packaged attachment first.

Changed assets record `meta.originalPath`, an actual known `meta.sourceName` when available, and `meta.assetNaming:{version:1,basis,collisionOf?}`. Existing metadata is retained. These fields are audit data, not extra interface copy. Keep original input archives separately; a renamed package does not replace historical imports or frozen session resources. When publishing new readable URLs for an existing catalog, retain the old byte-identical URLs as aliases.

Renaming changes signed content. If an input has an active signature, the helper refuses changes unless `--invalidate-signature` is explicit. That option preserves the old signature under `bank.meta.invalidatedSignatures` with reason `asset-paths-normalized`, removes the active signature, and produces an unsigned result that must be signed again. It never relabels a changed package Canonical. The signing helper checks filenames before contacting the account service, so normalization always precedes account approval.

For an integration that publishes assets separately, import the dependency-free `normalize_records(records, *, registry=None, invalidate_signature=False)` function. It returns a deep-copied record list and a mapping for **every** original asset path, including unchanged paths. An optional shared `{path:sha256}` registry resolves cross-package conflicts; process packages in a stable order. The registry changes only after successful normalization. Callers must move/copy exact bytes using the returned mapping and keep historical URLs where already published. `validate_asset_names(records)` checks the convention without mutation.
