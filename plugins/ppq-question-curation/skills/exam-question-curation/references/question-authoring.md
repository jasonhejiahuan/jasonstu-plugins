# Response authoring for PPQ

The original paper is the question. Response formats are optional ways to practise
it. Start from the source task and marking rule, then choose the smallest familiar
interaction that helps a learner answer. Do not attach every format to every
question merely because the application supports it.

New bank packages must include [bank provenance](ppq-base-v1.md#bank-provenance):
the original creator, declared AI model (or `null`), packaging agent/model and
time, origin and actual verification status. Externally supplied exercises stay
third-party and unverified until their sources are checked. Preserve original
attribution and unknown metadata when adapting exercises; a converter is not
the original author. Format validation does not establish source accuracy.

| Learner's task | Format | Author's responsibility |
| --- | --- | --- |
| Explain independently | Short answer | Keep the exact MS and accept alternatives; leave semantic judgement manual. |
| Recall a missing phrase | Fill the gaps | Mask the meaningful phrase once; include valid spellings; do not leave its answer elsewhere in the frame. |
| Identify several relevant ideas | Key points | Give the actual selection count; map wrong statements only to marks they contradict. Preserve any-N caps and dependencies. |
| Recognise one complete answer | Choose one | Use comparable, coherent options, a single unambiguous key and plausible misconceptions. Avoid answer-length clues. |
| Supply a calculated/measured value | Numerical answer | Supply the unit, expected values, source-supported tolerance and exactly which final-value marks it earns. |
| Assemble a developed argument | Essay puzzle | Preserve accepted alternatives and authored reasoning order; check the puzzle separately from the manually assessed original exam marks. |

Numerical answer is deliberately just a text field with a fixed unit and the same
Check answer / Adjust score actions. It supports scientific notation without a
formula editor. Where other formats exist, it does not replace the familiar
initial response. A numerical-only original can use a single numeric mode. It
counts as independent work; a correct number does not verify a derivation.

## Numerical contract

```json
{
  "id": "numeric",
  "kind": "numeric",
  "label": "Numerical answer",
  "numeric": {
    "accepted": [2.5],
    "unit": "m/s",
    "absoluteTolerance": 0.05,
    "points": ["final-value"],
    "sourceBasis": "Record the relevant MS precision/range here."
  }
}
```

The example is illustrative, not a Cambridge answer key. Tolerance is in the
displayed unit; `relativeTolerance: 0.02` means 2%. Do not infer tolerances from
the number of displayed decimal places. No unit conversion, symbolic equivalence
or significant-figure assessment is implicit. Keep method, drawing and reasoning
marks manual when the response cannot demonstrate them. Unknown nested metadata
is preserved by normal import/export and sync, so attach source provenance and
editorial explanations instead of silently discarding them.

## Essay sentence puzzles

Sentence assembly uses `kind:"essay"`, `manual:true` and an explicit `essay`
specification. Ordered sentence IDs persist as the answer. See the
[essay puzzle contract](essay-puzzles.md) for accepted sets, required sentences,
reasoning chains, balanced evaluation and action/outcome pairs. A completed
puzzle never automatically awards the original examination marks.

## Capped alternatives

For a capped “any N” answer, retain every official alternative in `mark_scheme`.
A `cloze` or `single` mode may declare `pointScope` for one explicit full-credit
pathway: include known unique point IDs, their prerequisites and enough marks to
reach the original maximum. Every mapping must stay within that scope. Other
kinds reject this field. This does not change the independent answer, its cap or
accepted source alternatives; see [PPQ Base](ppq-base-v1.md).

## Studio interaction boundaries

- Preserve selectable original prose, authored breaks and figure ordering.
- Use the shared 16/18/24/40px type groups and normal theme controls.
- Keep instructions specific to the original task or the necessary response rule.
  Put optional guidance in the manual help button; never auto-open a tutorial.
- Offer keyboard and touch access; do not require dragging, timing or gestures.
- Preserve drafts, feedback, score correction and focus mode for each format.
- New kinds require importer, scoring, rendering, accessibility, history, XP,
  recommendations and server-statistics support. A new JSON label alone is not a
  functioning question type. Unsupported kinds must be rejected on import.

## Publishing content revisions

Append a revision under the stable question ID. Keep every published record and
all original MS/figure bytes. Existing sessions keep their captured revision;
fresh sessions use the latest one. Do not rewrite old attempts or invent aliases
to make different response/scoring content look identical.

For the October 2026 Physics diagram batch, edit the reviewed editorial records
`research/physics-guided/{mechanics,waves,circuits}.json`, with source evidence in
the corresponding `*-source.json` and `*-review.md` files, then run
`python3 scripts/build_physics_guided.py`.
The builder preserves original records, generates only the three authored guided
formats, validates published hashes and repackages the unchanged source images.
It does not generate physics answers. The separate Essentials addition lives in
`research/content/starter-guided-2026-10-05.jsonl` and is applied by
`scripts/build_starter_bank.py` after source consolidation. Do not edit generated
public JSONL to bypass these reviewed inputs. Rebuild the delivery manifest with
`node scripts/build-bank-manifest.mjs` after changing a generated bank. Use the
application importer and targeted content tests, then check the real local
interaction before beta.

## Response-type completion history

A submitted question keeps a separate saved record for each mode ID within a practice session. Profile statistics group those records by response kind, counting at most one completion for the same question/kind/session, even if an author supplies two mode IDs of that kind. The practice response footer exposes **Adjust score** immediately after submission. Changing the score or editing that response updates its record; it does not count as another completion. A later practice session adds another completion. Profile → Question practice lists the question, practiced answer types, number of sessions, latest completion and latest score, with search and filters.

These details belong to the learner's own Profile and sync with their workspace. Existing Team profile sharing remains aggregate-only. Older saved sessions contribute the responses that are still present; responses overwritten before per-mode history existed cannot be reconstructed. Changing field names or importing a new question revision does not create a completion or award XP.
