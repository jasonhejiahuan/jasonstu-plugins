# Current PPQ storage boundaries

Snapshot: 2026-10-04, PPQ commit `8a0fc2d10f128255dd65b3590dd4582e61b00c15`. This is a source map for curation/integration, not permission to mutate live user data or a promise that schemas will never evolve. Re-read the listed files when working in a newer checkout. Exact portable snapshots of [record/state types](schemas/ppq-types.ts), [cloud types](schemas/cloud-types.ts) and [D1 migrations](schemas/d1-schema.sql) accompany this guide; [provenance](schemas/provenance.json) records their source hashes. Curation produces **bank content**; it must not regenerate account records or practice progress from study tables.

## Three different versions

| Layer | Current key/version | Authority |
| --- | --- | --- |
| Portable question bank | `schema:"ppq-base/1"` | `docs/ppq-base.md`, `web/src/lib/bank.ts` |
| Application state | `version:1` | `web/src/lib/types.ts`, `storage.ts` |
| Cloud transport | `wireVersion:2` | `web/src/lib/cloud-sync.ts` |
| D1 schema | migrations `0001`–`0004` | `web/migrations/*.sql` |

These are not interchangeable; do not bump all of them for a question-bank edit.

## Bank identity and full records

`QuestionBank` carries `records`, `raw`, `assets:Map<string,Uint8Array>`, optional `unavailableAssets` and `syncConflicts`. Preserve conflicting originals and their attachments for recovery. `raw` is original-import evidence; rebuilding it from normalized records destroys byte preservation.

Question origins use `(bankId,questionId,revision)`, encoded by `originRevision` in `collectionIdentity.ts`. Current runtime questions can carry `__scope:{runtime,bankId,questionId,canonicalId,members,original}`; each member retains its bank, question, revision, original/source and chapter information. Use the target's collection helpers to return to authored originals; do not export the combined runtime view as a new merged bank or erase a supplied unknown field merely because its name looks internal.

Chapter grouping uses subject, board, code, qualification and normalized chapter; it must not fold across unrelated courses or rewrite each bank's authored chapter metadata. Exact duplicate practice folding requires original task/content/rubric/mode/asset verification. Same ID or same topic is insufficient.

## IndexedDB and application state

Current database names: guest `ppq-practice-lab`; signed-in `ppq-practice-lab:user:<stable-user-id>`. IndexedDB version `1` has `state` and `banks` stores. `state/main` contains `AppData`, `state/cloud-base` contains the sync revision/base, and banks are keyed by bank record ID. Do not move one user's content into another user's namespace.

Current `AppData` keys include `version,statisticsResetAt,reviewEvents,activeBankIds,collectionDefaultsVersion,collectionAliases,preferences,sessions,currentSessionId,xp,rewardedQuestions,xpState,profile,practiceSetups`. Preserve any future keys too. Do not reset theme, motion, sound/volume or learning preferences when importing content.

Sessions retain `bankId/bankIds,resources,userId,selection,questions,sources,attempts,drafts,syncConflicts,startedAt,completedAt,bonusAwarded,purpose`. Attempt records retain question/source snapshots, revision, answer, mode, grade, submission dates, XP basis, override history and flags. `reviewEvents` and `xpState` have their own historical identity/accounting information. Updating source metadata must not rewrite them, erase old revisions or manufacture new XP.

## Cloud wire data and D1

`packWorkspace`/`unpackWorkspace` encode the complete authored records and saved snapshots. Wire v2 uses `cloudQuestions,cloudQuestionData,cloudArchives,cloudAssets,cloudBanks` and tagged `$ppq` references (`question,archive,gzip,asset,map,set`). Question ID/revision summaries are indexes; they do **not** contain the full question or all metadata. Never reconstruct an import from those summaries or manually build the compressed envelope. Use current helpers and assert restored records/assets equal their input. Unknown bank fields must survive packing, unpacking and merge conflict preservation.

Read current migrations and server code before any integration. Relevant D1 keys:

| Table | Keys/content | Curation boundary |
| --- | --- | --- |
| `user_data` | PK `user_id`; `revision,upload_id,stats,updated_at,progress_hash` | Sync revision and derived statistics; not question originals |
| `user_data_chunks` | PK `(user_id,chunk_index)`; `data` | Opaque validated workspace chunks; do not hand-edit |
| `user_question_stats` | PK `(user_id,bank_id,question_id,question_revision)`; score/possible/date | Derived practice index; preserve bank/revision identity |
| `assignments` | PK `id`; `team_id,question_set,assignee_ids,...` | Question-set references, not copies of full bank metadata |
| `users` | Stable `id`, provider identity, mutable username, permissions, `is_owner` | Identity and rights are outside question curation |
| `teams,team_members,invitations` | Team/user keys, scoped rights, invitation state/version | Use authenticated application APIs when assignment is authorized |
| `audit` | Actor/action/target/detail/date | Preserve required audit trail for authorized changes |

`CloudQuestionSet` currently has `id,title,description,questionIds,bankIds`, optional `questionRevisions` and optional `archiveBase64` (the exported original bank archive for non-built-in content). Preserve an existing archive exactly; use the application's exporter/transport helper when one is required. Do not print or invent Base64 in AI-authored JSONL. A question set alone does not hold all bank metadata; retain the referenced bank/original archive. Detect ambiguity across banks rather than guessing which bare question ID was intended.

The latest migrations add `progress_hash`, the question lookup index, protected site ownership and invitation pause/version fields. Do not insert defaults or alter migrations merely to load a question bank. The authenticated sync API owns concurrency and revision handling; direct SQL or local-storage rewriting bypasses those protections and is unnecessary for curation.
