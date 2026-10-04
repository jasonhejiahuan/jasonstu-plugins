# Release validation: 1.0.0

Checked 2026-10-04. Application integration baseline: PPQ main `8a0fc2d10f128255dd65b3590dd4582e61b00c15`.

- 13 portable Python tests pass on the development machine. They exercise synthetic QP/MS PDF parsing, resumable extraction, missing/HTML MS handling, explicit partial exit status, cover/visual review boundaries, stale source hashes, duplicate occurrence rejection, pending records, nested metadata and published revisions.
- A read-only run against two existing QP/MS pairs parsed four real PDFs and produced 14 candidates. No cover or answer verification was claimed by that run. It exposed a CFF font dependency; `fonttools` was added and the run repeated successfully.
- PPQ's existing `bank.test.ts` and `cloud-sync.test.ts` passed: 71 tests covering the actual importer, archive checks, historical content and quiet sync.
- A further integration fixture imported and exported a complete synthetic `.ppqbank.jstu` with two source appearances, historical/new revisions and an attachment. It retained unknown root fields and nested metadata in sources, source details, rubric points, modes/options/blanks and assets. Original JSONL BOM/CRLF and attachment bytes were preserved. Cloud wire v2 packing/unpacking restored the full records, original bytes and session snapshots. The independent recursive metadata comparison passed on its exported JSONL.
- Logo files are byte-for-byte copies of PPQ's existing `web/public/favicon.svg`.

The standalone helpers do not implement PPQ's importer or certify manual transcription accuracy. Raster decoding and future schema changes still require the target application's current validation. This release does not modify the running PPQ application or its live database. Cross-platform CI and the marketplace installation check are recorded with the release/commit checks.
