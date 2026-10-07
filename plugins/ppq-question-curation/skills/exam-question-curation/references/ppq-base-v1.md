# PPQ Base v1

PPQ Base is the question-bank interchange format for **PPQ Practice Lab**. Its wire format is UTF-8 JSONL: one complete compact JSON object per line. Shared source and attachment metadata are recorded once and referenced by ID. The format keeps readable field names while avoiding pretty-print whitespace and repeated paper metadata.

This document is normative for `schema: "ppq-base/1"`. The canonical answer field is `mark_scheme`; legacy imports and saved snapshots are normalized at the compatibility boundary described in [the migration notes](mark-scheme-migration.md). New exports use canonical field names, including Original import export; for legacy files only, this schema-alias change takes precedence over byte-for-byte text preservation. The TypeScript models in `web/src/lib/types.ts` describe the currently understood fields; they are deliberately extensible. The parser in `web/src/lib/bank.ts` performs syntax and semantic validation without projecting data onto those models.

## Files and records

A `.jsonl` file can be used alone when it has no registered attachments. A complete `.ppqbank.jstu` file is a ZIP containing `bank.jsonl` and every registered attachment beneath `assets/`. A manifest with asset records remains useful to AI tools, but importing it alone into the app fails with a missing-attachment message. Remote HTTPS source links are links, not bundled files; use asset records when an offline portable copy is required.

Existing archives using the old `.ppqbank` suffix need only be renamed to `.ppqbank.jstu`; their ZIP contents do not change. The importer accepts the new suffix and provides a rename instruction for the old one. The internal `exportBank` format argument remains `'ppqbank'`.

Exactly one `bank` record comes first. Other records may follow in any order. Blank lines, CRLF and one leading UTF-8 BOM are accepted and retained in the original archive text. New AI output should use LF, no BOM, no indentation and no blank lines.

| Record | Required fields | Optional understood fields |
| --- | --- | --- |
| `bank` | `type`, `schema:"ppq-base/1"`, `id`, `title`, `language`; new packages also require `provenance` below | Legacy imports may omit `provenance`. All extension fields are retained. |
| `source` | `type`, `id`, `board:"cie"\|"edexcel"`, `subject`, `qualification`, `code`, `series`, `paper` | `qp`, `ms`: an existing asset ID or absolute HTTPS URL. |
| `asset` | `type`, `id`, `path`, `mediaType`, `sha256` | Raster images may supply paired positive integer `width` / `height` in pixels; additional provenance or licensing metadata. |
| `question` | `type`, `id`, `rev`, `source`, `part`, `stem`, `marks`, `concept`, `mark_scheme`, `modes` | `context`, `chapter`, `difficulty`, `location`, `sourceDetails`, `meta`; all additional fields are retained. |

IDs are non-empty strings without whitespace or control characters. Record IDs are unique within their record type; questions are unique by `(id, rev)`. `rev` is an integer starting at 1. Multiple historical revisions are permitted in an interchange file. The question library, counts, chapter filters and new practice selection use only the greatest revision for each question ID. Editing appends a revision at `max(existing rev for that ID) + 1`, retaining earlier records and session snapshots. A collision at the same ID and revision must never silently overwrite existing content.

`source` is a source record ID or a non-empty array of unique source IDs, ordered with the primary source first. `part` is the exact original question number, such as `1(a)(ii)`. `marks` is the original positive integer maximum. `difficulty` must contain both `level` and `basis`; omit it when unknown. `location` contains positive one-based `qpPage` and `msPage` page numbers. Do not infer difficulty from the mark total.

### Bank provenance

Every newly authored or repackaged `.ppqbank.jstu` must supply this structured bank metadata. Existing imports without it remain valid; importing or exporting a legacy bank does not invent its authorship or review status.

```json
"provenance": {
  "version": 1,
  "origin": "third-party",
  "verification": "unverified",
  "creator": {"name": "Carlos", "model": null},
  "packagedBy": {"name": "OpenAI Codex", "model": null},
  "packagedAt": "2026-10-07T10:00:00Z"
}
```

`origin` is `first-party` or `third-party`, relative to the platform publisher. `verification` is `unverified` or `source-verified`; record only source review actually performed, independently from format validation. Third-party is an origin classification, not a claim about quality or examination-board endorsement. The example timestamp is illustrative; use the actual packaging time in ISO 8601 with a timezone.

`creator` identifies the original resource author and its declared AI model; `packagedBy` identifies the person/agent that produced this package and its known model. Both require a nonempty `name` and a `model` that is either a nonempty declared/known string or `null`. Never guess a model from writing style, an agent product name or a previous task. Preserve an existing creator when converting a file; the converter belongs in `packagedBy`. For the teacher resources supplied on 7 October 2026 only, the user specified Carlos when no creator was declared and `null` when no model was declared. This is not a default for unrelated imports.

These objects remain extensible. Preserve licensing, source filenames/digests, tool versions, original attribution, review evidence and unknown nested metadata. The parser validates known fields whenever `provenance` is supplied. Packaging tools must enforce its presence for new deliverables; compatibility import/export continues to accept legacy files. Question bank shows a compact Third-party / Unverified badge, author and known creator model. It need not show packaging details, evidence or a disclaimer paragraph. Metadata never changes question identity, scoring or frozen attempts.

An optional bank-header `signature` carries the account-approved publisher seal described in [question bank signing](question-bank-signing.md). The Canonical badge requires cryptographic verification with the application's pinned public keys. A self-declared origin or source-review status does not grant that badge. Signing preserves original authorship and verification status; modified signed content requires a new signature.

### Multiple appearances of the same question

A single question card may refer to several papers: `"source":["9702_s25_21","9702_w25_21"]`. The first source remains the practice source. Root `part`, `location`, `marks`, `mark_scheme` and response modes describe that source; paper styling, chapter grouping and suggested grading use it. Browsing an additional source never silently switches the active mark scheme. Counts and random selection count question IDs, not appearances.

For every secondary ID, `sourceDetails` must contain an object keyed by that ID with `part`, `marks`, `location:{qpPage,msPage}` and `markSchemeRaw`. Preserve its exact examiner wording, including alternatives, exclusions and guidance. Extra provenance fields, original extraction IDs and unknown nested metadata are retained. The reviewed seasonal merger also retains differing authored scaffolds/rules in `authoredModes` / `authoredMarkScheme`, and typography differences in `originalStem` / `originalContext`; these are audit extensions and never activate secondary scoring. Shared paper data and QP/MS URLs stay in the corresponding `source` record. Optional primary-source details must agree with root part, marks, pages and mark_scheme text. A details key not present in `source`, a missing secondary detail, repeated source ID or unequal original marks is rejected.

Merge only after checking the original wording, necessary context, diagrams/tables, response task and original marks. Different wording or a different required context stays a separate card even if the concept or answer is the same. Minor typography or whitespace differences may be recorded in provenance; do not normalize away substantive differences. Different original maxima require separate cards. Differing MS wording is retained per appearance and never combined into a synthetic official mark_scheme. In v1, each paper ID represents one occurrence on a card; separate subparts in the same paper must remain separate cards.

Adding a source to a published question appends a revision under the same stable ID. Retain all published records and old session snapshots; only the latest revision appears in the library. Historical progress stays scoped to its saved revision. Newly extracted duplicates within one unpublished batch can share one revision. There is no fuzzy automatic deduplication during import: an author must identify and source-check the match. See [multi-source example](examples/valid-multi-source.jsonl).

### Chapter and rough-difficulty conventions

These are PPQ Base v1 authoring conventions, not a new format version or grading algorithm. `chapter` is a readable classification string. Reuse an existing chapter label for the same subject, exam board, subject code and qualification across collections where possible; the editor also accepts a new label. A blank chapter remains unclassified. Today and Practice automatically group active collections by the structured tuple `(source.subject, source.board, source.code, source.qualification, chapter)`, independent of bank ID. Matching normalizes letter case, whitespace and numeric-prefix formatting such as `02. Kinematics` / `2 Kinematics`; it does not guess synonyms or merge different chapter names or courses. Blank and explicit `Unsorted` labels share the unclassified group for their course. Each group counts and draws from the unique runtime questions produced by the existing verified-original deduplication rules. This is a derived view: imported chapter text, records, source/asset ownership, metadata and single-bank exports are unchanged. Previously saved bank-specific chapter selections resolve to the matching current groups; historical session snapshots retain their original question order. Do not use delimiter-concatenated identifiers that can collide with user-provided text.

The app recognizes three optional rough levels: `confidence`, `balanced` and `challenging`. They are practice-selection labels, not formal exam-board difficulty ratings, predicted marks or changes to the mark_scheme. For example: `"difficulty":{"level":"balanced","basis":"User-assigned rough level"}`. New manual assignments default to that basis; source-backed or user-written bases should remain intact unless deliberately edited. Omit `difficulty` for an unrated question. Existing arbitrary level strings remain valid and are preserved losslessly; the app treats them as unrated for these three rough groups instead of guessing a conversion.

Changing the question wording or its classification creates a new revision. Editing chapter or wording without changing difficulty must retain the complete existing difficulty object, including its basis and unknown nested fields. Editing a recognized difficulty retains its extension fields; explicitly selecting Unrated removes the current revision's difficulty, while older revisions retain it. Metadata-only classification changes do not invalidate source-wording verification. The shipped questions remain unrated until someone supplies a supported basis; the app does not assign ratings automatically.

## Original content and assistance

`stem`, `context` and `mark_scheme.raw` preserve source wording, significant line breaks and examiner wording. Keep `Accept` / `Do not accept` instructions in `mark_scheme.raw` even when no automatic rule implements them. A normalized study-table question is provenance or a learning aid; it must not replace the original question text.

Content strings use a restricted Markdown convention:

- CommonMark emphasis, paragraphs, lists and explicit `\n` line breaks; GFM tables.
- Inline `$…$` and block `$$…$$` TeX math. Use `x^{2}` and `x_{0}` inside math to preserve superscripts and subscripts.
- Raster images use `![descriptive alternative text](asset:asset-id)`. Source QP/MS links use their source record fields. Preserve original images and record SHA-256; never generate a replacement and describe it as an original.
- Raw HTML is not an execution surface. The renderer must skip raw HTML and apply a restrictive URL policy. Scripts, event-handler markup, executable embeds, and script/data URLs are rejected in known content fields. Unknown extension strings are data and must never be executed as HTML or JavaScript.
- Ordinary content should not carry per-character PDF coordinates. Store exceptional local layout measurements in extension metadata when necessary.

### Diagram short-answer imports

A diagram is source content, not a separate response kind. Reference its raster attachment from `context`, `stem` or an ordered `paperLayout` block. Use `short` for independent writing and add guided modes only when reviewed answer frames and scoring mappings exist; the current diagram collection supplies all four familiar modes in revision 2. Keep its position relative to the original wording, labels, axes, units and caption. A crop must come from the original paper and retain the complete figure; never redraw, recolour or remove answer-relevant content. Optional paired asset `width` / `height` describe the actual decoded pixel dimensions and reserve image space before loading. They do not change the image bytes or require per-character layout coordinates.

For an extraction awaiting the user's check, use question metadata `reviewStatus:"pending-user-review"`, `questionType:"diagram-short-answer"` and `requiresCalculation:false`. Record diagram provenance in `meta.diagrams` as objects containing `assetId`, positive one-based `qpPage`, `crop:[x0,y0,x1,y1]`, `units:"pt"` and `pdfSha256`. Crop coordinates use the PDF page's top-left origin in points (1/72 inch); if another coordinate system is supplied, preserve it and describe it explicitly rather than guessing a conversion. These are extensible authoring conventions, not a claim that extraction has been verified. Keep exact QP/MS variant, pages, source filenames, extraction method and review notes alongside them. Unknown nested diagram metadata continues to round-trip without loss.

The current diagram collection excludes tasks requiring numerical calculation, numerical graph reading, calculation-dependent previous answers, drawing, sketching or annotating a diagram. A qualitative subpart from a mixed question is eligible only when its necessary context is retained and it can be answered independently in text. Numbers printed in a figure do not alone make a question computational. Selection must be checked against the actual task and mark scheme, not inferred by a keyword filter. Keep literal matching only where reliable; otherwise set `manual:true` on the affected mark_scheme points and retain the exact mark scheme for self-review.

Each answer mode lives in `modes` and leaves the original question untouched. Every mode has an `id` unique within that question, a supported `kind`, a `label`, and an optional assistance `prompt`. Different authored mode IDs may share one kind. Response kinds are separate from exam-paper variants (`source.paper` / `source.variant`) and from question revisions; adding a response mode does not import another original question.

| `kind` | Configuration | Grading interpretation |
| --- | --- | --- |
| `short` | No additional required fields. | Literal word/phrase groups in the mark_scheme; unsupported judgement is self-review. |
| `single` | `options:[{id,text,points:[point-id]}]`, `correct:[one-option-id]` | The selected correct option awards its mapped marks. At least two options are required. |
| `multi` | Same `options`, `correct:[option-id,…]`, optional `maxSelections` | All correct options mapped to a particular point must be selected for that point. A selected incorrect option mapped to the point prevents its award. The selection limit may be lower than the number of correct options for “any two” capped mark_schemes. |
| `cloze` | `blanks:[{id,label,accepted:[string,…],points:[point-id,…]}]`, optional `template` | Every blank mapped to a point must match an explicitly accepted answer. `{{blank-id}}` placeholders in `template` reference declared blanks. |
| `numeric` | `numeric:{accepted:[number,…],points:[point-id,…],unit?,absoluteTolerance?,relativeTolerance?}` | A finite numerical value in the displayed unit. Award only explicitly mapped final-value marks within the authored tolerance. Unmapped method marks must remain manual. |
| `essay` | `options`, `manual:true`, `essay:{minimum,maximum,accepted,modelOrder,required?,chains?,requirements?}` | Select and arrange sentence cards. Authored coverage and order checks produce learning feedback; the original marks always require self-review. See [essay puzzles](essay-puzzles.md). |

For `cloze` and `single` only, optional `pointScope:[point-id,…]` selects an explicit full-credit pathway within a capped “any N” mark scheme. IDs must be unique, nonempty and known; include every prerequisite of each scoped point, and enough marks to reach the original maximum. All answer mappings must stay inside the scope. The complete `mark_scheme`, original examiner wording and alternatives remain unchanged; only the scoped rows participate in this guided format. Other response kinds reject `pointScope`.

Do not attach point IDs arbitrarily to distractors: those mappings encode specific mark conflicts. Where a rule requires judgement, preserve the rule and set `manual:true` rather than approximating it as a deterministic choice. Statistics keep assisted modes separate from independent written and numerical answers.

Numerical tolerances are nonnegative and explicit: accept within the larger of `absoluteTolerance` and `abs(expected) * relativeTolerance`; omitted tolerances mean exact numerical equality (apart from floating-point rounding). The unit is fixed visible context, not an inferred conversion. Authors must not label final-value matching as verification of working, significant figures or a proof. An invalid number remains available to correct rather than becoming an accidental zero. See the [author guide](question-authoring.md) and [illustrative numeric import](examples/valid-numeric.jsonl).

## `mark_scheme` and whole marks

`mark_scheme` contains the original `raw` text, a non-empty scoring-rule `version`, a non-empty `points` array, optional `cap`, and optional `ignorePunctuation` (default false). Each point contains `id`, positive integer `marks`, and `label`.

Optional point fields:

- `all` is an array of required groups, each containing explicitly acceptable alternative phrases. `[["distance"],["per unit time","divided by time"]]` means **distance AND (per unit time OR divided by time)**. Matching is case-insensitive, whitespace-normalized and bounded by words. No inferred synonyms or fuzzy spelling expansion is supplied.
- `requires` lists point IDs that must earn their full mark before this point can be awarded. Missing dependencies and cycles are invalid. Dependency chains are limited to 64 levels.
- `reject` lists literal expressions that require self-review rather than a confident automatic award.
- A mode-level `manual:true` with optional `notes` requires self-review only for that response mode.
- Point-level `manual:true` requires self-review in every mode; `notes` carries the explanation. A point without a usable short-answer matching rule is also marked for self-review in that mode.

`min(sum(points.marks), cap ?? sum(points.marks))` must equal the original `question.marks`, and `cap` cannot exceed the original maximum. This supports, for example, three one-mark alternatives capped at two. Unknown mark_scheme metadata survives interchange but has no automatic grading meaning. Suggested marks, user corrections, question revisions and rule versions remain separate data in the application. After each submission, **Adjust score** is available immediately in practice and in review. A correction records the learner’s score without editing the published `mark_scheme`; restoring the suggestion removes that current override. Per-mode history preserves completed modes, while edits of the same mode do not add another completion. See [Profile and XP](https://github.com/jasonhejiahuan/PPQ-Practice/blob/main/docs/user-profile-xp.md).

## Lossless contract and import safety

For every **accepted** document, normalized import → save → export preserves every canonical field name, JSON value type, string code unit, array order and nested unknown field. The documented legacy marking-field aliases are the only schema-name normalization. Object key order, indentation and numeric spelling such as `1.2300` versus `1.23` are not semantic metadata. The app also stores the original input text. **Original import** exports the original record set rather than current edits: canonical imports retain their exact UTF-8 bytes, including line endings/BOM; legacy marking fields are reserialized under the canonical names. See [the exact compatibility boundary](mark-scheme-migration.md).

Numbers must be finite and representable without losing their decimal identity when parsed and serialized by JavaScript. Integers must be within the safe integer range. The parser compares numeric token values against the serialized result before accepting them. Use strings for exact large integers, high-precision decimal values and signed zero. Examples: `"9007199254740993"`, `"0.123456789012345678901"`. NaN and infinity are not JSON values. No `BigInt`, `Date`, `undefined`, sparse array, symbol key or circular object may be silently passed through a managed edit.

Duplicate keys are rejected even when written with different JSON escapes (`"title"` and `"ti\u0074le"`). `__proto__` and `constructor` are preserved as own data fields without changing object prototypes. Validation errors provide the original line number and JSON field path. Unsupported schema versions/types, duplicate records or revisions, missing source/asset/point references, invalid scores, malformed modes and unsafe executable content are rejected before storage.

Attachments use their exact bytes. Supported types are PDF, PNG, JPEG, WebP, AVIF, GIF and plain text; executable SVG/HTML are not accepted. `path` must be a unique safe relative file beneath `assets/`, with no `..`, backslashes, absolute path or query/fragment. `sha256` is a 64-character hexadecimal digest. ZIP import/export verifies every registered attachment against its digest. Raster attachments must also match the declared file signature and decode successfully with the browser's native image decoder; declared dimensions must match. Each temporary bitmap is released immediately after verification, with no image re-encoding. Unregistered ZIP files are rejected rather than dropped. Encrypted, ZIP64, multi-disk, duplicate-entry and unsafe-path archives are rejected.

Import resource limits: 25 MiB JSONL text, 20,000 records, 64 nesting levels, 100 MiB archive upload and total expanded archive contents. These are explicit resource bounds, not lossy truncation rules. Import is validate → preview → atomic transaction; a rejected file writes no partial bank. Asset references are checked before the preview and bytes are verified before commit.

No serialization format can recover source metadata that an AI extractor never supplied. Verification against the same paper variant remains required. Do not delete unknown metadata to make an import pass; correct the specific validation error or encode an exact numeric value as a string.

## AI authoring prompt

Copy the prompt from [`examples/ai-import-prompt.md`](examples/ai-import-prompt.md). A compact valid bank is in [`examples/valid-minimal.jsonl`](examples/valid-minimal.jsonl); its question is explicitly illustrative, not claimed as an exam original. Invalid examples demonstrate duplicate keys and numeric precision errors.

For a large bank, ask the AI for source records once and question records in manageable chunks. Concatenate complete lines and validate the resulting document. Attachments are copied separately and hashed by code, never emitted as Base64 by the AI. Do not abbreviate or omit metadata for character savings. Keep long source text once per question and source-level metadata once per paper.

## Measured size and validation

For the current 66-question Essentials manifest (72 retained question records), compact JSONL uses **269,221 characters / 269,915 UTF-8 bytes**. The same records formatted with two-space indentation use **404,905 characters / 405,599 UTF-8 bytes**, about 33.5% more compact in JSONL. The 16 bundled PDFs add 10,454,100 bytes; later 2026 and seasonal QP/MS papers remain external references. These are measurements of this exact dataset, not a promised reduction for every bank; [`content-size-report.json`](https://github.com/jasonhejiahuan/PPQ-Practice/blob/main/docs/content-size-report.json) is regenerated by `scripts/build_starter_bank.py`.

Run `cd web && npm test -- src/lib/bank.test.ts src/lib/markSchemeCompatibility.test.ts src/lib/guidedScope.test.ts src/lib/numeric.test.ts`. Tests cover unknown nested metadata, Unicode and multiline formulae, duplicate escaped keys, numeric boundaries, strict failures, original-text byte preservation, dependency/cap rules, malformed modes, dangerous paths, ZIP duplicate/expansion checks, and attachment integrity. A complete starter-bank export/import verifies all 16 original QP/MS PDFs.

Library API: `parseBank(raw)` validates a manifest without attachment bytes; `importBank(file)` validates a complete user import; `serializeBank(bank)` normalizes current records; `verifyAssets(bank)` checks bytes keyed by asset ID; `exportBank(bank, 'jsonl'|'ppqbank', original?)` exports current or archived original content. A JSONL export with asset records is explicitly a manifest; use `.ppqbank.jstu` for a portable full bank. Bundled starter assets are fetched lazily before a full export, so they do not delay first practice.

Question prose must remain selectable rich text: place each original figure between the surrounding text blocks, keeping authored line breaks, emphasis, subscripts and superscripts. Crop only the original figure, internal labels and caption; never use a raster screenshot as the question stem or context paragraph. Source-backed manual transcription resolves undecoded text. Original MS row evidence may remain a separate image, with extracted marking text retained in `mark_scheme.sourceText`.

## Regional paper editions and structured paper layout

A regional edition remains the same course and paper: for example `code: "WAC11"`, `paper: "01"`, `variant: {"code":"A","region":"China"}`. The region label is explicit source metadata, not inferred from a suffix. The reader recognizes legacy Edexcel IAS `01A` references as a regional edition without rewriting original records or inferring a country. Region-aware identities keep separate publications and their attempts distinct; shared chapters still group under the same course. Existing non-regional publication identities are unchanged.

Optional `question.paperLayout` preserves tables, T-accounts, blank rows and ordered text blocks in the original record, portable export and saved attempts. See [the layout contract and example](paper-layout.md). Old questions do not require migration.
