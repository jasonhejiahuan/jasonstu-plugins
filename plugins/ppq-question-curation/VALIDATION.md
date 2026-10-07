# Release validation: 1.3.0

Checked 2026-10-07. Attachment naming follows the earliest PPQ official-basename convention; account signing retains the 1.2.1 protocol.

- 33 portable Python tests pass. The ten new naming cases cover official Cambridge combined-paper names, existing Edexcel filenames, opaque aliases, source/page image names, repeated image occurrences, same/different-byte and case-insensitive collisions, readable-name priority, idempotency, explicit signature invalidation, unknown metadata, unchanged original files and signing rejection before network activity.
- A complete archive round trip on all 12 supplied teacher packages preserved every one of the 1,077 attachment occurrences byte-for-byte, retained IDs and digests, and kept every source/question JSONL line exactly unchanged. All renamed outputs passed the new filename validator; the original package hashes remained unchanged. Temporary outputs were removed after checking.
- Synthetic archive tests retain BOM, CRLF and literal Unicode line/paragraph separators. Missing, modified or unregistered attachments fail without output. Existing signatures survive unchanged packages; a changed path requires explicit invalidation and keeps the old signature in audit metadata before a new signature is requested.
- Plugin metadata/reference and standalone skill validation pass. Generated plugin and skill packages include the dependency-free normalizer and its tests. New-package naming does not change compatibility of historical platform imports.

These checks establish naming and data preservation, not the accuracy of the teacher's source transcriptions. The prior real Worker/D1 signing evidence is retained below; this release does not change its request/approval protocol.

## Earlier release evidence

# Release validation: 1.2.1

Checked 2026-10-07 against the PPQ working tree. Publication and live deployment are separate release operations.

- 23 portable Python tests pass, including creator/model requirements, original-file preservation, opaque approval polling, public-key signature verification, rejection of forged/unknown signatures, cross-origin approval rejection and archive attachment preservation. Signing tests use temporary keys and synthetic local resources; no private platform key or live account is required.
- A real local Worker/D1 smoke passed the actual CLI request, authenticated fixture preview/approval, token polling, signature verification and separate output creation. The PPQ importer and pinned key verifier accepted the archive, and an export/reimport remained Canonical with unchanged attachment bytes. This exposed and fixed the CLI Origin header required by the service. The fixture used an isolated local identity and never touched a real account or remote database.
- The shared canonical fixture matches the platform hash for BOM/CRLF, legacy marking aliases, extension keys, JavaScript number formatting, Unicode and array ordering. The platform's 12 signature tests pass with the same fixture.
- Plugin metadata/reference validation and skill validation pass. Signing requires Python 3.10+ and Node.js 22+; CI now supplies Node 24 explicitly on every operating system.
- PPQ metadata/importer checks passed 51 tests. The imported teacher collection suite passed 15 tests covering all 12 delivered JSONL files, canonical import/export, every registered attachment hash and a complete essay-package round trip with preserved historical revisions.
- A separate read-only comparison against the teacher's 12 original archives found all 10,120 non-header original records unchanged and all 1,077 registered attachment occurrences byte-identical. These checks establish data preservation and importer compatibility, not source accuracy.
- New portable question examples include illustrative provenance. Current question modes, canonical `mark_scheme` compatibility, provenance and essay contracts are bundled; cloud/database snapshots keep their explicitly recorded earlier baseline.

No plugin publication, production permission grant, source review or live account approval is implied by these local checks. The installation result and release artifacts should be recorded by the publishing task.

# Release validation: 1.0.0

Checked 2026-10-04. Application integration baseline: PPQ main `8a0fc2d10f128255dd65b3590dd4582e61b00c15`.

- 13 portable Python tests pass on the development machine. They exercise synthetic QP/MS PDF parsing, resumable extraction, missing/HTML MS handling, explicit partial exit status, cover/visual review boundaries, stale source hashes, duplicate occurrence rejection, pending records, nested metadata and published revisions.
- A read-only run against two existing QP/MS pairs parsed four real PDFs and produced 14 candidates. No cover or answer verification was claimed by that run. It exposed a CFF font dependency; `fonttools` was added and the run repeated successfully.
- PPQ's existing `bank.test.ts` and `cloud-sync.test.ts` passed: 71 tests covering the actual importer, archive checks, historical content and quiet sync.
- A further integration fixture imported and exported a complete synthetic `.ppqbank.jstu` with two source appearances, historical/new revisions and an attachment. It retained unknown root fields and nested metadata in sources, source details, rubric points, modes/options/blanks and assets. Original JSONL BOM/CRLF and attachment bytes were preserved. Cloud wire v2 packing/unpacking restored the full records, original bytes and session snapshots. The independent recursive metadata comparison passed on its exported JSONL.
- Logo files are byte-for-byte copies of PPQ's existing `web/public/favicon.svg`.

The standalone helpers do not implement PPQ's importer or certify manual transcription accuracy. Raster decoding and future schema changes still require the target application's current validation. This release does not modify the running PPQ application or its live database. Cross-platform CI and the marketplace installation check are recorded with the release/commit checks.
