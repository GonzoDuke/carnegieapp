# Vision eval harness

Quantifies the extraction step's accuracy so prompt or model changes can
be **graded**, not vibe-checked.

## Usage

```bash
npm run eval:vision                       # one trial per photo
npm run eval:vision -- --repeat=3         # 3 trials per photo, averaged
npm run eval:vision -- --strict           # fail if recall regresses >5%
npm run eval:vision -- --photo=garage.jpg # one specific photo
npm run eval:vision -- --escalate         # also run Opus on low-conf photos
```

Each run prints per-photo precision, recall, mean confidence, plus the
list of titles the model found that aren't in the truth file (`extra`)
and titles the truth file expected but the model missed (`missed`).

**Why `--repeat`:** Anthropic's vision model is sampling-based, so the
same photo returns slightly different extractions across calls. At
`--repeat=1` (default) a single noisy result can flip 1–2 books per
photo per run. With `--repeat=3` precision/recall are averaged across
trials and the headline numbers move only when prompt or model
changes do. Cost scales linearly with N — a 10-photo run at
`--repeat=3` is 30 vision calls.

## Setup (one-time)

The harness ships with empty `photos/` and `truth/` folders. Add your
own:

1. **Drop 8–12 photos into `eval/photos/`.** Pick a spread:
   - 1 easy (clear spines, ~15 books)
   - 2 medium (~25 books, mixed condition)
   - 1 hard (worn spines, glare, small format, or 40+ books)
   - 1 edge case (books lying flat, foreign-language spines,
     ex-library stickers, etc.)
   - 3–7 from your actual photo history if available
2. **Hand-write `eval/truth/<basename>.json`** for each photo (matching
   filename minus extension). Format:

   ```json
   {
     "books": [
       { "title": "Dune", "author": "Frank Herbert", "isbn": "0441172717" },
       { "title": "Pale Fire", "author": "Vladimir Nabokov" }
     ]
   }
   ```

   `isbn` is optional. Title and author are matched fuzzily; small
   typos and variations in author casing don't fail the match.
3. **Run the harness once** to write `eval/baseline.json`.
4. **Iterate on prompts** — every subsequent run compares to the
   baseline. `--strict` mode fails the build if recall drops by more
   than 5%.

## What the harness does NOT touch

- The per-user vision API daily budget. The harness calls
  `extractBooksFromImage` directly, bypassing `incrementUsage()`.
- The lookup chain (ISBNdb / Open Library / Google Books). The
  scaffold tests *vision extraction quality only* — title, author,
  ISBN-readability per book. End-to-end metadata quality (does the
  ISBN actually resolve? does the title match LT's record?) would
  require running the lookup chain too, which has extensionless
  relative imports the strip-types loader can't resolve. Add `tsx`
  and re-thread the imports if you ever need that view.
- Production data. The harness reads your local files and calls the
  Anthropic API only.

## Costs

A run with 10 photos averages ~10 vision calls on Sonnet 4.6. Add
~30% for ambiguous photos that escalate to Opus when run inside the
production route — but the harness skips that escalation by default
(it tests Sonnet alone unless you pass `--escalate`).

At list price you're looking at a few cents per run. Don't put this
in CI without thinking it through.

## What the baseline tracks

`eval/baseline.json` stores the per-photo numbers from the most recent
"good" run. It's gitignored — your baseline is local. If you want a
shared team baseline, commit it deliberately.
