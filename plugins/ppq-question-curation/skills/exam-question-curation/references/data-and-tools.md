# Data contract and helper commands

The research format below tracks evidence; it is **not** PPQ Base or a replacement for original question-bank records. All inputs may carry additional fields. Helpers never rewrite inputs and retain their exact bytes under the generated study directory's `source-records/`. Those copies are an evidence archive; relative PDF paths still refer to the original manifest directory. Share a corpus only with its original directory structure and appropriate distribution rights.

Use Python 3.10+ in an available runtime or isolated environment. Install `scripts/requirements.txt` there when its PDF/font dependencies are absent; `fonttools` handles CFF font encodings encountered in real papers. Do not change the user's system Python. `study_table.py` and `check_metadata.py` use only the standard library. Inputs are JSONL: one complete object per nonblank line; duplicate keys and non-finite numbers are rejected.

## Paper manifest: `papers.jsonl`

One record per expected QP/MS pair. `id`, `board`, `code`, `year`, `session`, `component`, `qp`, `ms` are required. IDs used by these helpers contain letters/digits, dots, underscores or hyphens. `year` is an integer; component/code/session are strings. Keep a consistent session vocabulary. File paths resolve relative to this manifest, not the current shell directory. Missing files use an object with `path:null` and a reason; they remain in expected coverage.

Illustrative record (the URLs are examples, not actual exam sources):

```json
{"id":"sample-2030-june-21","board":"cie","code":"sample","year":2030,"session":"June","component":"21","subject":"Illustrative","qualification":"AS","syllabus":{"edition":"sample-2030","url":"https://example.org/syllabus"},"qp":{"path":"pdf/sample_qp.pdf","url":"https://example.org/qp.pdf","retrievedAt":"2030-01-01T00:00:00Z"},"ms":{"path":"pdf/sample_ms.pdf","url":"https://example.org/ms.pdf","retrievedAt":"2030-01-01T00:00:00Z"},"screening":{"status":"pending"},"meta":{"sourceNotes":[]}}
```

After visually checking each cover, set that component's `identityReview` to `{ "sha256": "measured digest", "reviewer": "reviewer identity", "reviewedAt": "ISO date/time" }`. After whole-paper screening, set `screening` to `{ "status":"complete", "qpSha256":"measured digest", "reviewer":"reviewer identity", "reviewedAt":"ISO date/time" }`, with exclusions/decisions as extra fields. These are attestations of actual work, not flags to add merely to pass the script.

```sh
python3 SKILL_DIR/scripts/corpus.py --manifest research/papers.jsonl --out research/audit
```

Outputs: `corpus.json`, `corpus.md`, hash/version-keyed page text under `text/`, and `candidates.jsonl`. Candidate IDs use paper/hash/page/offset; they can change after a source revision and are not stable question IDs. MS gaps do not drop QP candidates. Duplicate bytes are reported for investigation, not automatically interpreted as different appearances. Text cache reuse is keyed by source SHA-256 and extractor version.

Exit codes: `0` all expected file pairs parse; `2` partial audit written with missing/invalid files; `1` malformed input or tool failure. **Exit 0 says nothing about cover identity, screening or answer verification.** Empty-text pages are counted and need visual/OCR work. Preserve rejected originals or move them to a task-owned rejection directory after recording their status; this helper does not move or delete files.

## Reviewed occurrences: `occurrences.jsonl`

Statuses: `candidate`, `verified`, `excluded`. Each needs `id`, `paperId`, `status`. Excluded records also need a reason. Each verified record additionally needs all fields below, using actual reviewed values:

```json
{"id":"sample-q1-a","paperId":"sample-2030-june-21","status":"verified","part":"1(a)","marks":1,"question":"Synthetic example: define a widget.","msRaw":"Illustrative marking point only.","answer":"A study phrasing, separately attributed.","keywords":["illustrative"],"accept":[],"doNotAccept":[],"chapter":null,"syllabus":null,"evidence":{"qpPages":[2],"msPages":[3],"qpSha256":"actual measured QP digest","msSha256":"actual measured MS digest","visualChecked":true,"reviewer":"reviewer identity","reviewedAt":"ISO date/time"},"meta":{"future":{"keep":[null,false,"9007199254740993"]}}}
```

This example is not runnable evidence: replace it with facts from the source, not guessed hashes/pages. Pages are positive one-based PDF indexes, not printed labels. If `chapter` is supplied, retain its syllabus reference/edition. `question` is the original complete task (or retain separate `context`/attachments as additional fields); `answer` is study prose, while `msRaw` preserves the exact MS. Use extra fields for parent context, mark dependencies, emphasis, figures and examiner guidance. A helper's minimum required fields do not authorize discarding richer input.

## Group decisions: `groups.jsonl`

```json
{"id":"widget-definition","title":"Define a widget","basis":"Required answer checked against both original mark schemes; original occurrences retained.","occurrenceIds":["sample-q1-a","another-reviewed-occurrence"],"meta":{"reviewNotes":[]}}
```

Grouping is optional. Every member must be verified; an occurrence may appear in one study family. Ungrouped verified occurrences automatically remain as single-entry rows. Different official wording remains in the occurrence appendix; study grouping never silently chooses one MS as authority for another paper. Frequency is computed, never provided as a trusted number.

```sh
python3 SKILL_DIR/scripts/study_table.py --manifest research/papers.jsonl --audit research/audit/corpus.json --occurrences research/occurrences.jsonl --groups research/groups.jsonl --out research/study
```

Outputs: `table.md`, `occurrence-details.md`, `summary.json`, and exact input copies in `source-records/`. Omit `--groups` for individual rows. The helper checks audit freshness, current PDF hashes, recorded cover/visual reviews, page bounds and duplicate occurrences. It fails before generating a new table on inconsistent evidence. Old outputs remain on failure: check the exit code and rerun successfully before treating them as current. Pending/excluded counts refer to the supplied occurrence ledger; they do not assert that the regex candidate queue or all paper questions have been fully processed.

## Complete bank metadata comparison

```sh
python3 SKILL_DIR/scripts/check_metadata.py original.jsonl normalized-export.jsonl
python3 SKILL_DIR/scripts/check_metadata.py published.jsonl extended.jsonl --allow-new-revisions
```

The first compares all records recursively by `(type,id,rev)`; only record/object-key order and equivalent JSON numeric spelling may differ. Array order, strings, booleans, nulls, unknown keys and nested values must match. The second permits new records and higher question revisions while requiring every published record to remain unchanged. It is not a schema validator, cryptographic asset check or proof of correct source wording; run the actual PPQ importer too. For an original-byte export, additionally compare bytes/hashes, including BOM and line endings.

To verify the bundled helper behavior:

```sh
python3 -m unittest discover -s SKILL_DIR/scripts -p 'test_*.py'
```

Tests create synthetic PDFs in temporary directories. They neither access external services nor contain exam originals.
