# Essay sentence puzzles

An essay puzzle selects and orders authored sentence cards. It is a guided
response kind (`essay`), recorded separately from independent writing in Profile,
review evidence, XP and server statistics. Sentence selection and ordering are
learning feedback. Examination scores always require manual assessment against
the preserved original `mark_scheme`.

```json
{
  "id": "essay-puzzle",
  "kind": "essay",
  "label": "Essay puzzle",
  "manual": true,
  "options": [
    {"id":"point","text":"An authored point.","points":[]},
    {"id":"reason","text":"Its developed consequence.","points":[]},
    {"id":"wrong","text":"A distractor.","points":[]}
  ],
  "essay": {
    "minimum": 2,
    "maximum": 2,
    "accepted": ["point","reason"],
    "required": ["point","reason"],
    "modelOrder": ["point","reason"],
    "chains": [["point","reason"]]
  }
}
```

This is an illustrative shape, not examination content. Each sentence has a
unique option ID. `accepted` contains every sentence that may appear in an
accepted puzzle answer; `required`, when present, requires those IDs in every
answer. `modelOrder` is one complete route and must itself pass the configured
rules. Every ID in these fields and chains must reference an accepted option.
The importer rejects malformed rules, unsupported automatic essay grading,
invalid counts and a model route that fails its own requirements.

Each chain expresses prerequisite order: selecting a later sentence requires its
predecessor earlier in the essay. Chains do not require adjacency. Unknown
metadata, sentence wording, option order and marking evidence remain preserved.
`options[].points` may retain valid legacy mappings, but essay checking never
uses those mappings to award examination marks. Authored distractor explanations
may remain in `option.meta.puzzleFeedback`.

For balanced evaluation, `essay.requirements.groups` maps authored group names
to minimum counts, for example `{"positive":1,"negative":1,"judgement":1}`.
Options use `group`, with `meta.argumentGroup` accepted as the preservation
fallback. `judgementLast:true` places a selected judgement last. Omit `required`
when the teacher permits alternative combinations; do not turn the model route
into the only accepted answer.

For action/outcome assembly, use
`requirements:{pairedActions:[["a1","o1"],["a2","o2"]],pairCount:1}`.
Each pair uses distinct IDs. The answer must contain exactly the requested
number of complete pairs, with each action immediately before its outcome.
Evaluation-group rules cannot be combined with this pair mode. Sentence limits
must accommodate twice the pair count.

The control provides keyboard/touch sentence selection and 44px move/remove
buttons; dragging is not required. Selected IDs are an ordered `string[]` in
ordinary local drafts and attempts, so offline persistence, conflict handling,
per-mode history and frozen session revisions use existing mechanisms. The
submitted view shows the assembled essay, puzzle feedback, a manually expanded
model essay and the existing score correction/original-mark-scheme controls.

The October 2026 teacher import appends revision 3 for 13 Accounting and 12
Business puzzles. Revisions 1–2 remain intact. The adapter derives the native
specification from preserved `sentenceLimits`, `modelOrder`, `acceptedPointIds`,
`alternativeCombinationRules` and `reasoningChains` metadata. Accounting
alternatives remain alternatives; Business authored required sets retain their
coverage rules. Published source-review claims remain third-party evidence.

Validate with `cd web && npm test -- src/lib/essay.test.ts`. The suite exercises
all 25 imported model routes, alternative evaluation answers, ordering,
action/outcome pairs, invalid configuration, no automatic exam marks, saved
drafts/responses, guided statistics and keyboard-accessible markup.
