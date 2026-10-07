# Canonical `mark_scheme` fields

PPQ Base retains schema `ppq-base/1`. New banks, examples, editable records and exports use `question.mark_scheme`. Source occurrences use `markSchemeRaw` and the optional audit extension `authoredMarkScheme`.

The import boundary accepts the legacy aliases `rubric`, `rubricRaw` and `authoredRubric`. `normalizeMarkSchemes` in `web/src/lib/markSchemeCompatibility.ts` applies the same conversion to imported JSONL/packages, IndexedDB banks and sessions, cloud workspaces, restored server snapshots and recommendation input. Equal old/new fields collapse; conflicting values fail explicitly before an import or snapshot is saved. Unknown metadata, binary assets and the original import text remain intact. No schema version bump or score recalculation is needed.

Current and Original import exports both use canonical fields. Original import preserves the imported record revisions and content; only a legacy schema spelling requires reserialization. An import that already uses canonical fields retains its exact Original import bytes, including line endings and a byte-order mark. The in-memory saved raw import remains available as original evidence.

Saved question snapshots, per-mode attempts, manual scores, XP and aliases retain their identities. Existing review-event content keys deliberately retain their historical serialization through `markSchemeFingerprint`; renaming a property does not create a new question or erase learning evidence. Compatibility spellings remain in that boundary, its tests and migration audit records; original user metadata and preserved raw import evidence may also contain the old word. This is not a global replacement inside user-authored strings.

## Source-integrity verification — 5 October 2026 snapshot

At migration, the three public banks and the archived Physics 2026 JSONL/package pair were synchronized internally; subsequent content releases must regenerate the matching package and delivery manifest. Existing attached figures and PDFs were compared byte for byte. Historical question revisions are retained alongside newly authored revisions.

The migration audit is recorded in `research/content/schema-normalization-2026-10-05.json`. Its hashes identify that migration snapshot, not a promise that later authored revisions have the same file digest. Every previously tracked non-header record was compared with its pre-migration version after only these explicitly allowed transformations:

- The three schema aliases above and schema references from `meta.sourceEmphasis[].field` to `mark_scheme.raw`.
- One authored metadata sentence for `9618_w22_12-5-d-ii`: “four-bullet rubric” becomes “four-bullet mark_scheme”. This is an editorial label, not official examiner wording.

Question wording, original examiner text, source locators, original marks, grading rules and asset bytes remain unchanged. V1 and published-physics digest fixtures were updated only after the reverse-alias comparison passed. Content tests assert these normalized baselines; they do not claim that renamed JSON bytes are identical to the previous schema.
