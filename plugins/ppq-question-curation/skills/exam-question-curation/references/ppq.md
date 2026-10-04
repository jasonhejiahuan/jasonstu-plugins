# PPQ question-bank adapter

Use this only when PPQ output is requested. The bundled [PPQ Base v1 snapshot](ppq-base-v1.md) and [illustrative sample](examples/valid-multi-source.jsonl) make the skill portable. They were checked against PPQ main `8a0fc2d10f128255dd65b3590dd4582e61b00c15` on 2026-10-04. On every new run, prefer the target repository's current `docs/ppq-base.md`, `docs/examples/ai-import-prompt.md`, `web/src/lib/types.ts`, `web/src/lib/bank.ts` and tests. Compare new fields rather than assuming this snapshot is latest forever.

## Map verified material without reducing it

Create one `bank` record with `schema:"ppq-base/1"`, source records once per paper, assets separately, and complete question records. Keep the original question task/marks and raw scoring language; store a study-family label or frequency as supplemental research metadata, not replacement source text. Record the frequency's scope and supporting occurrence IDs. Do not fabricate fields to make an import pass.

Preserve supplied records recursively, including **unknown root keys**, source/asset extensions, `difficulty`, `meta`, `sourceDetails`, rubric points, nested options/blanks and mode extensions. Modify a deep copy of the full original record when adding a revision. Do not reconstruct from a whitelist of visible TypeScript properties, serialize only the table columns, rename arbitrary metadata or strip unknown values. Exact large integers/high-precision decimals stay strings; array order and Unicode/newlines matter. Never coerce an unknown difficulty into one of the UI's three labels.

| Record | Required keys | Preserve when present |
| --- | --- | --- |
| bank | `type,schema,id,title,language` | All root and nested extensions |
| source | `type,id,board,subject,qualification,code,series,paper` | `qp,ms`, syllabus, provenance and all unknown keys |
| asset | `type,id,path,mediaType,sha256` | Paired `width,height`, crop/licensing/provenance extensions |
| question | `type,id,rev,source,part,stem,marks,concept,rubric,modes` | `context,chapter,difficulty,location,sourceDetails,meta` and all unknown keys |
| rubric | `raw,version,points` | `cap,ignorePunctuation,sourceText` and extensions |
| point | `id,marks,label` | `all,requires,reject,manual,notes` and extensions |
| mode | `id,kind,label` | `prompt,options,correct,maxSelections,blanks,template,manual,notes` and extensions |
| option / blank | `id,text,points` / `id,label,accepted,points` | All authored scoring and extension fields |
| secondary source detail | `part,marks,location:{qpPage,msPage},rubricRaw` | `questionId,authoredModes,authoredRubric,originalStem,originalContext,meta` and all extensions |

The current modes are `short`, `single`, `multi`, `cloze`. Do not add a response format as a side effect of curation. Use only assistance that faithfully exercises the same mark points. Keep prompts/options separate from the original `stem`. Points use explicit marks, caps and dependencies. `min(sum(points.marks), cap ?? sum(points.marks))` must equal the original maximum. Semantic/list judgement that literal matching cannot safely represent remains `manual:true`, with actual original marking evidence.

## Sources, versions and assets

- New original: stable descriptive ID and `rev:1`. Existing original: `max(rev)+1`, retaining all published records; never overwrite a published revision. A later source addition cannot rewrite an old attempt's question or rubric snapshot.
- Only a verified identical original can use ordered `source:[primary,secondary,...]`. Keep the primary first and unchanged. Every secondary source needs its own exact part, original marks, QP/MS pages and raw MS in `sourceDetails`. Different marks, meaningful wording or necessary context require separate cards. In v1, two subparts in one paper remain separate cards; one source ID cannot represent both on one card.
- Runtime duplicate grouping is not file concatenation. Banks stay independent and all source/asset lookups stay bank-scoped. Preserve all authored origins and metadata even when one runtime representative is used. See [storage boundaries](ppq-storage.md).
- Preserve text → original figure → text order. Figure crops include the original diagram, internal labels and caption, not rasterized question paragraphs. Keep selectable prose, line breaks, emphasis and math. No invented replacement diagrams.
- Asset bytes live under safe `assets/` paths, with measured SHA-256 and actual dimensions. Preserve `meta.diagrams:[{assetId,qpPage,crop:[x0,y0,x1,y1],units:"pt",pdfSha256}]` when supplied (one-based pages, top-left point coordinates). Original MS row images may be separate evidence; extracted text stays in `rubric.sourceText`/`raw` as appropriate.
- A complete `.ppqbank.jstu` is a ZIP of `bank.jsonl` and every registered attachment. Do not embed Base64, substitute URLs for supplied bytes, silently omit unavailable assets, or include unrelated archive files. JSONL with asset records alone is a manifest, not a complete portable bank.

## Focused validation and handoff

1. Validate complete records with current `parseBank`/`validateBank`; verify asset digests and registered references. Use `importBank` for the actual archive, then `exportBank` and import again. Raster decoding needs a browser-capable environment; manifest parsing alone cannot verify it.
2. Use `check_metadata.py` on original and normalized exports. Check byte equality for Original import export and attachment bytes. Include a fixture with unknown nested metadata in source, asset, rubric, mode and secondary-source details, plus null/false and exact numeric strings.
3. When adding revisions, compare every published `(type,id,rev)` record before/after, not just the question count. Confirm the primary rubric/modes and saved attempt snapshots remain unchanged. In a PPQ checkout the relevant existing tests include `bank.test.ts`, `sources.test.ts`, `collections.test.ts`, `bankLibrary.test.ts`, and `cloud-sync.test.ts`; run the subset warranted by the change.
4. If requested to integrate, preview the actual imported collection and an example diagram/short-answer locally. Deploy and preview the real beta only when authorized. Do not change Access, account permissions, active user collections, settings or statistics as a side effect of producing a file.

Report original occurrences, unique cards, new revisions, merged source appearances, unresolved source checks and importer/round-trip evidence separately. A schema-valid record can still have a wrong transcription: source verification and format validation remain separate.
