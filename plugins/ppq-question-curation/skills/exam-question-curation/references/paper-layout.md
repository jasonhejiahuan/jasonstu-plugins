# Structured paper layouts

`QuestionRecord.paperLayout` is an optional, versioned layout extension to PPQ Base 1. Existing banks render `context` followed by `stem` unchanged. Structured layouts retain selectable text, original table headings, numeric formatting (amounts are strings), ledger sides, rule lines and blank answer space. They are display layouts, not a new response mode or automatic ledger marker. `paperLayout.version` is a layout schema version; `question.rev` identifies a content revision, and `mode.kind` identifies the answering interaction. None changes a source paper’s variant.

The executable example is [accounting-ledger-layout.jsonl](examples/accounting-ledger-layout.jsonl). Import it through Question bank to preview. It is an authored format fixture, not a past-paper question and not part of the bundled exam catalog.

## Layout contract

```json
{"version":1,"blocks":[
  {"kind":"context"},
  {"kind":"stem"},
  {"kind":"ledger","title":"Cash account","debitLabel":"Dr","creditLabel":"Cr",
   "debit":{"columns":[{"label":"Date","width":2},{"label":"Details","width":4},{"label":"£","align":"right","width":2}],"rows":[],"blankRows":6},
   "credit":{"columns":[{"label":"Date","width":2},{"label":"Details","width":4},{"label":"£","align":"right","width":2}],"rows":[],"blankRows":6}}
]}
```

- `stem` references the question's existing editable stem; include it exactly once. `context` references existing context and must appear exactly once if that field exists. This avoids stale duplicate prose when editing a question.
- `text` has a `text` Markdown field for intervening instructions or existing `asset:` figure references. Maintain original text → figure → text order.
- `table` has `title` and a `table` object. `ledger` has `title`, `debit`, `credit` table objects, and optional labels. No debit/credit labels are invented when absent from the source.
- Each table has 1–12 `columns` and 0–100 `rows`. Columns have a string `label`, optional `align` (`left`, `center`, `right`) and integer `width` weight (1–12). A row has `cells`; each cell has string `text`, optional positive `span`, optional `align`, and optional `rule` (`single`, `double`). Cell spans must cover exactly the columns. A row may also have `rule` for a whole-row total. Single rules are above; double rules are below.
- `blankRows` (0–40) explicitly retains answer space. Ledger sides pad to the same row count. On narrow screens, tables scroll within the question rather than shrinking original paper text or stacking Dr and Cr vertically.
- Rich text uses the existing safe Markdown renderer, asset validation and scoped asset IDs. HTML/CSS templates and executable markup are not accepted. Unknown nested JSON extension fields survive round trips.

Question bank → Edit → Paper layout edits the structured JSON. Saving validates the whole bank, creates a new revision and marks a changed layout as requiring source review. Clearing the layout restores normal text display. Earlier attempts keep their original snapshots. Changed financial tables participate in exact-content comparison and review scheduling, preventing the reuse of scores across different tables.

## Importing a ledger question

Transcribe all necessary transaction data and instructions with the question; preserve monetary strings, dates, original headings and row order. Store the blank account as a ledger block, not as a picture of a question. Source verification must include both QP and MS pages. A template alone is not a verified complete import. An account preparation task must not be assigned definition-style keyword marks: retain question-specific entries and use an appropriate existing response mode or explicit self-review until an entry-aware grader is implemented. Preserve the original entry requirements in `mark_scheme.raw`; numerical final-value matching does not verify ledger sides, row placement or double-entry working.
