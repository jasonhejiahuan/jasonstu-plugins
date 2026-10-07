# PPQ question-bank adapter

Use this only when PPQ output is requested. The bundled [PPQ Base v1 snapshot](ppq-base-v1.md) and [illustrative sample](examples/valid-multi-source.jsonl) make the skill portable. The question-bank contract was refreshed against the 2026-10-07 PPQ working tree; its snapshot metadata identifies the source state. Cloud/database snapshots retain their separately dated baseline. On every new run, prefer the target repository's current `docs/ppq-base.md`, `docs/examples/ai-import-prompt.md`, `web/src/lib/types.ts`, `web/src/lib/bank.ts` and tests. Compare new fields rather than assuming this snapshot is latest forever.

## Map verified material without reducing it

Create one `bank` record with `schema:"ppq-base/1"`, source records once per paper, assets separately, and complete question records. Keep the original question task/marks and raw scoring language; store a study-family label or frequency as supplemental research metadata, not replacement source text. Record the frequency's scope and supporting occurrence IDs. Do not fabricate fields to make an import pass.

Preserve supplied records recursively, including **unknown root keys**, source/asset extensions, `difficulty`, `meta`, `sourceDetails`, mark_scheme points, nested options/blanks and mode extensions. Modify a deep copy of the full original record when adding a revision. Do not reconstruct from a whitelist of visible TypeScript properties, serialize only the table columns, rename arbitrary metadata or strip unknown values. Exact large integers/high-precision decimals stay strings; array order and Unicode/newlines matter. Never coerce an unknown difficulty into one of the UI's three labels.

| Record | Required keys | Preserve when present |
| --- | --- | --- |
| bank | `type,schema,id,title,language,provenance` for new packages | All root and nested extensions |
| source | `type,id,board,subject,qualification,code,series,paper` | `qp,ms`, syllabus, provenance and all unknown keys |
| asset | `type,id,path,mediaType,sha256` | Paired `width,height`, crop/licensing/provenance extensions |
| question | `type,id,rev,source,part,stem,marks,concept,mark_scheme,modes` | `context,chapter,difficulty,location,sourceDetails,meta` and all unknown keys |
| mark_scheme | `raw,version,points` | `cap,ignorePunctuation,sourceText` and extensions |
| point | `id,marks,label` | `all,requires,reject,manual,notes` and extensions |
| mode | `id,kind,label` | `prompt,options,correct,maxSelections,blanks,template,numeric,essay,manual,notes` and extensions |
| option / blank | `id,text,points` / `id,label,accepted,points` | All authored scoring and extension fields |
| secondary source detail | `part,marks,location:{qpPage,msPage},markSchemeRaw` | `questionId,authoredModes,authoredMarkScheme,originalStem,originalContext,meta` and all extensions |

Current modes are `short`, `single`, `multi`, `cloze`, `numeric` and `essay`. Use only modes the target importer supports. Adapting a teacher essay puzzle is allowed when requested; it does not authorize arbitrary platform features. Read [essay puzzles](essay-puzzles.md) before mapping sentence selection and ordering. Use only assistance that faithfully exercises the same mark points. Keep prompts/options separate from the original `stem`. Points use explicit marks, caps and dependencies. `min(sum(points.marks), cap ?? sum(points.marks))` must equal the original maximum. Semantic/list judgement that literal matching cannot safely represent remains `manual:true`, with actual original marking evidence.

## Bank provenance

New packages require `provenance:{version:1,origin,verification,creator:{name,model},packagedBy:{name,model},packagedAt}` on the bank record. See [the normative details](ppq-base-v1.md#bank-provenance). `origin` is `first-party` or `third-party`; `verification` is `unverified` or `source-verified`, based on review actually performed. Successful parsing, public distribution, AI authorship and source self-claims do not verify the questions.

Credit the original resource author in `creator.name`; preserve any declared model in `creator.model`. Record the current packaging agent/operator separately in `packagedBy`, with the known model or `null`. Unknown models are always `null`; do not guess the exact model from a product name. `packagedAt` is the actual ISO 8601 timestamp including a timezone. Preserve existing creator attribution, hashes, licenses, review evidence and unknown nested keys. If this changes a published bank header, preserve the original input separately and record the provenance enrichment; do not rewrite old question revisions or frozen sessions.

A user-provided author fallback applies only to the stated batch. For example, when the user says their supplied teacher files are Carlos's work, use Carlos only where those files do not declare an author, retaining an absent model as `null`. Do not adopt this name for unrelated files. Third-party resources may be delivered before source review when the user requests that scope, with an unverified badge and intact evidence. Do not invent official marking certainty from puzzle completion.

Run `python3 SKILL_DIR/scripts/check_bank_provenance.py OUTPUT.ppqbank.jstu` (or `OUTPUT.jsonl`) before delivery. This checks required new-package metadata without changing the file; the real importer still validates content, assets and unknown metadata preservation. Legacy app imports remain compatible without this field. Show compact author/model and origin/review badges where UI is requested; do not add disclaimer paragraphs or expose packaging internals by default.

For the publisher signature after packaging, follow [account signing](question-bank-signing.md). A valid canonical signature identifies the approving PPQ account while preserving the original author; it does not change third-party or unverified metadata.

## Sources, versions and assets

- New original: stable descriptive ID and `rev:1`. Existing original: `max(rev)+1`, retaining all published records; never overwrite a published revision. A later source addition cannot rewrite an old attempt's question or mark_scheme snapshot.
- Only a verified identical original can use ordered `source:[primary,secondary,...]`. Keep the primary first and unchanged. Every secondary source needs its own exact part, original marks, QP/MS pages and raw MS in `sourceDetails`. Different marks, meaningful wording or necessary context require separate cards. In v1, two subparts in one paper remain separate cards; one source ID cannot represent both on one card.
- Runtime duplicate grouping is not file concatenation. Banks stay independent and all source/asset lookups stay bank-scoped. Preserve all authored origins and metadata even when one runtime representative is used. See [storage boundaries](ppq-storage.md).
- Preserve text → original figure → text order. Figure crops include the original diagram, internal labels and caption, not rasterized question paragraphs. Keep selectable prose, line breaks, emphasis and math. No invented replacement diagrams.
- Every newly packaged attachment follows [readable asset naming](asset-naming.md); preserve meaningful official source filenames and use confirmed source/role/page names for images. Normalize filenames before validation and signing, updating both manifest paths and ZIP entries while preserving bytes, IDs and history. Existing signatures must be explicitly invalidated and then renewed after path changes.
- Asset bytes live under safe `assets/` paths, with measured SHA-256 and actual dimensions. Preserve `meta.diagrams:[{assetId,qpPage,crop:[x0,y0,x1,y1],units:"pt",pdfSha256}]` when supplied (one-based pages, top-left point coordinates). Original MS row images may be separate evidence; extracted text stays in `mark_scheme.sourceText`/`raw` as appropriate.
- A complete `.ppqbank.jstu` is a ZIP of `bank.jsonl` and every registered attachment. Do not embed Base64, substitute URLs for supplied bytes, silently omit unavailable assets, or include unrelated archive files. JSONL with asset records alone is a manifest, not a complete portable bank.

## Focused validation and handoff

1. Normalize and check every attachment name with `normalize_asset_names.py` before signing. Require bank provenance with `check_bank_provenance.py`, then validate complete records with current `parseBank`/`validateBank`; verify asset digests and registered references. Use `importBank` for the actual archive, then `exportBank` and import again. Raster decoding needs a browser-capable environment; manifest parsing alone cannot verify it.
2. Use `check_metadata.py` on original and normalized exports. Check original import byte equality and attachment bytes. The current app canonicalizes legacy `rubric` aliases to `mark_scheme`; allow only that documented compatibility normalization, and compare canonical records thereafter. Include a fixture with unknown nested metadata in source, asset, mark_scheme, mode and secondary-source details, plus null/false and exact numeric strings.
3. When adding revisions, compare every published `(type,id,rev)` record before/after, not just the question count. Confirm the primary mark_scheme/modes and saved attempt snapshots remain unchanged. In a PPQ checkout the relevant existing tests include `bank.test.ts`, `sources.test.ts`, `collections.test.ts`, `bankLibrary.test.ts`, and `cloud-sync.test.ts`; run the subset warranted by the change.
4. If requested to integrate, preview the actual imported collection and an example diagram/short-answer locally. Deploy and preview the real beta only when authorized. Do not change Access, account permissions, active user collections, settings or statistics as a side effect of producing a file.

Report original occurrences, unique cards, new revisions, merged source appearances, unresolved source checks and importer/round-trip evidence separately. A schema-valid record can still have a wrong transcription: source verification and format validation remain separate.
