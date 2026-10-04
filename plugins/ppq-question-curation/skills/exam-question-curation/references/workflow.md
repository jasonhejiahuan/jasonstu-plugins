# Acquisition, verification and completion

## Scope and source discovery

Record a frozen scope before measuring completeness: exact years, sessions, components, variants, syllabus editions and inclusions/exclusions. An expected record represents one QP/MS pair, not one download. Record unavailable or cancelled papers with supporting evidence; do not quietly remove them from the denominator. Specimen, resit, March and alternative variants belong only when in scope. New sources after the cutoff require a new audit, not a silent frequency change.

The workflow was distilled from a CIE AS Physics P2 / CS P1 collection. Its historical 2016–2025 snapshot included 9702 plus overlapping 9608/9618 transition years. Those dates, codes, counts and provider URLs are **not** defaults or verified current availability. Confirm the requested series and syllabus with current primary sources.

Search by board/code, year, season, paper, variant and `qp` / `ms`. CIE filename series commonly use `s`, `w`, `m`; a filename is only a locator. Verify the cover. QP and MS must agree on course, year, session and component. Similar names or a shared answer do not establish a match.

If MetaSo is requested, use its installed skill/API as documented in the current environment. Discover direct PDFs, persist results and fill exact remaining gaps. Do not assume old tool names, upload limits or static URL patterns still work. A small successful sample can justify a bounded batch; every result still needs validation. Try another legitimate source for gaps. Stop a repeatedly challenged source and record the failure; never treat a challenge page as content or bypass access controls.

Download to staging, record requested/final public URL and retrieval time, validate, then promote into the corpus. Keep valid originals when retries fail. Compare hashes before replacing a source; retain both versions and invalidate dependent reviews when bytes change. Keep rejected responses outside the valid corpus. Do not store cookies, authorization headers, signed URL credentials or account data in shareable manifests. Uploading a corpus to an external knowledge base needs current authorization.

## Extraction and screening

Page-indexed text can flatten columns, lose bold/underline, omit symbols and confuse question numbers with headers. OCR is unverified transcription. PDF page index and printed page label may differ; store both when useful.

For fixed-answer tasks, shortlist definitions, state/identify, explain how/why, processes and short structural answers. Calculation/method-mark questions are lower priority only when that matches the request. Judge the actual response and rubric; the presence of numbers does not make a question calculation-only. Retain parent context and prerequisite statements for standalone subparts.

Screen every requested paper, including table-based prompts and commands broken across lines. Record paper-level screening status and exclusions with reasons. Candidate search cannot certify recall: a zero-match or scanned paper needs inspection, not an automatic “no eligible questions” decision. A caller-provided example intended to check coverage is a holdout: run the general pipeline first, then check it.

## Occurrence review

For each promoted occurrence:

- Confirm cover identity, full part number, QP/MS pages and original maximum against the same component.
- Inspect wording, parent context, figure, units, emphasis and line breaks; retain original question text separately from a normalized study title.
- Inspect the exact MS row and relevant examiner notes. Preserve points, alternatives, order, dependencies, “any N”, list rules, Accept and Do not accept. Do not turn mutually exclusive alternatives into a requirement to provide all of them.
- Store raw MS and source hashes, reviewer and date. An empty Accept/Do not accept list is valid only after checking the relevant MS. Missing verification is not an empty list.
- Map chapters against an identified syllabus edition. Keep legacy-to-current mappings explicit. Leave unknown classification unset.
- Resolve uncertain extraction by source-backed transcription or leave it pending. Never invent wording, marks or digests, or label extraction as verification.

A searchable text layer does not prove emphasis was checked. Visually inspect relevant pages using an available renderer/browser and retain the original PDF. Render only needed pages after locating candidates.

## Recurrence and deduplication

| Identity | Purpose | Rule |
| --- | --- | --- |
| File bytes | Avoid repeated downloads/extraction | SHA-256; a mirror is not another paper |
| Paper + exact subpart | Count actual appearances | One occurrence per original task; MS alternatives count once |
| Study family / practice card | Organize learning | Study families may group reviewed variants; practice cards require exact original equivalence |

Keep per-occurrence marks and rubrics within a study family. Different wording, required context or marks remain separate PPQ cards. A concept merely mentioned in a stem or offered as an optional answer to an unrelated prompt is not that concept being directly tested. Partially reviewed families have a lower-bound count; report pending evidence instead of extrapolating.

Sort by distinct reviewed occurrences descending, with deterministic ties. Distinct papers can be reported separately; repeated variants are appearances, not necessarily independent topics. Keep all supporting occurrences so counts can be recalculated. Leave frequency unset outside the declared scope.

## Output and resumption

Structured records are the source of truth; derive Markdown to avoid stale manual totals. A concise table may group identical answers; differing official versions stay in a linked occurrence appendix. Link every row to supporting QP/MS pages and distinguish official text from study paraphrase. For public sharing, distribute only content authorized for that distribution; do not automatically package an examination PDF corpus.

At interruption, save scope, counts, missing components/reasons, failed URLs without credentials, screened/unscreened papers, pending IDs, grouping decisions and next batch. Another agent should be able to resume without chat history.

Audit separately: expected/valid/missing components; cover and whole-paper screening coverage; candidates/reviewed/excluded/pending occurrences; families and reproducible counts; and, for PPQ, importer/asset checks and preserved histories. “Corpus complete”, “screening complete”, “selected answers verified” and “all questions resolved” are distinct claims. Do not stop at a candidate queue when a fully verified collection was requested.
