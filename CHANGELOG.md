# Changelog

Carnegie — a personal-library cataloger. Photograph shelves, scan
barcodes, type ISBNs; export LibraryThing-compatible CSV.

## Unreleased

### Tools

- `tools/compare-batches.mjs` — compare two batches for overlap and
  optionally merge them into one worksheet, in shelf order, with rows
  appearing in both tinted and a Decision dropdown.

  Matches on ISBN, then exact call number, then call number ignoring a
  trailing year (same work, different printing), then normalised title plus
  author surname — reporting which tier caught each pair so the weak ones
  can be judged rather than trusted.

  The tiers exist because the in-app `/duplicates` page matches on ISBN
  alone, and only 15–33% of the reference collection has one; ~100% have a
  call number. Comparing "Ref Pulls" against "Second Round Cuts" found 41
  books in both, of which just 10 had ISBNs — the other 31 were invisible to
  the existing check.

## 1.3.0 — 2026-08-11

### Added

- **Excel worksheet export**, alongside the LibraryThing CSV. The CSV is a
  machine format — LibraryThing's column names, an importer's column order,
  and location, blurb and notes crammed into one Comments cell separated by
  newlines, which is what makes rows unreadable in Excel.

  The worksheet is the other thing: a sheet to sit and work in. Reading
  order (Batch · Box · Location · Call number · Title · Author · …), one
  fact per column, a frozen header, AutoFilter, sensible column widths, and
  empty **Decision · Note · Who · When** columns with a **Keep / Discard /
  Undecided** dropdown so three people spell "Discard" the same way.

  Per batch from the batch page; whole collection from the Archive. Unlike
  the CSV it includes books still pending review — a book you haven't got to
  yet is still a book on the shelf — and batches you haven't marked
  complete. Trashed books stay out. A second "About" sheet records what was
  exported and when.

  The Box column is empty for books catalogued before `books.upload_id`
  existed; nothing recorded which book came from which photo.

### Review loop

- **Confirming a book no longer reloads the page.** Every per-book action
  was a native form POST answered with a 303, which re-rendered the whole
  batch and bounced you to the top. Now fetch + refresh: scroll position,
  open rows and your expand/hide preferences all survive. Measured holding
  at 8125px across an un-confirm/re-confirm on a 102-book batch.
- Re-lookup reports in a toast beside the row instead of a banner at the top
  of a page you'd scrolled well past.
- Deleting a duplicate from `/duplicates` no longer navigates you out of the
  list you're working through.
- The no-JS form fallback is deliberately dropped. Carnegie is an installed
  PWA driven by a camera; the guarantee was costing a page reload per action
  for something never true in practice.

### UI

- **Phones can search.** The search bar is desktop-only and nothing below
  that breakpoint linked to `/search` — on the device you hold at a shelf,
  the library wasn't searchable at all.
- The Photo/Scan/Manual panel collapses once a batch has books. You're
  reviewing at that point, not capturing, and it sat between you and the
  list on every visit.

## 1.2.0 — 2026-08-11

Carnegie is now scoped as an **intake tool** and nothing more. Browsing a
collection, making decisions about it, and publishing a finding aid move
to Frick, a companion app over the same database. This release removes
what Frick supersedes and adds what it needs.

One database migration, additive only. Nothing was dropped.

### Removed

- **Public sharing is gone** — the `/share/<token>` pages, `/sharing`,
  the API route, `lib/share.ts`, and the four share components. It
  exposed every non-deleted batch through a single account-wide token,
  including books still in the review queue. Frick replaces it with
  per-collection publishing and cross-batch search.
- Carnegie now has **no anonymous surface**. The app holding the
  Anthropic key, blob credentials, and camera access serves nothing
  without a session.
- `users.share_token` / `shared_at` are kept as dead columns rather than
  dropped — removing them is destructive, has to land after a deploy,
  and buys only tidiness. See the note in `lib/db/schema.ts`.

### Changed

- **Downloading a CSV no longer archives the batch.** It used to stamp
  `exported_at`, so pulling a working copy silently filed the batch away
  with no way back. Export is now a pure read; "Mark complete" and
  "Reopen" are explicit and reversible.
- Export no longer opens LibraryThing in a new tab, and the button reads
  "Download CSV". LibraryThing is one destination, not the only one.
- **"Batch" is the noun everywhere.** The UI had drifted to "cart" while
  the schema and routes said "batch". The master CSV's leading column is
  now `Batch`.
- `max_tokens` raised on the vision calls (2048 → 8192 extraction,
  → 4096 detection). It's a ceiling, not a budget, and 2048 was untested
  at the 25-book shelves the app targets — truncation there fails
  silently.

### Added

- **Call numbers are editable.** Display-only before, which made a shelf
  address you couldn't correct when the lookup missed or disagreed with
  the spine. Also shown in the collapsed row so a list reads in shelf
  order.
- **Non-LC spine stickers are surfaced instead of discarded.** Vision
  reads shelf stickers, but `extractLcc` accepts LC-shaped strings only,
  so a Dewey number or a genre label was stripped and dropped. For a
  collection that isn't LC-classified that may be the only classification
  there is.
- **`books.upload_id`** — links a book to the photo it came from. Frick
  joins through it to read the current box label. `ON DELETE SET NULL`;
  existing rows are NULL and can't be backfilled.
- `drizzle.config.ts` gains `schemaFilter` / `tablesFilter` / `strict`.
  Without them a routine `db:push` could drop tables it didn't know
  about — which matters now that Frick shares the database.

### Vision

Moved to **Claude Sonnet 5** with **Opus 5** escalation, and raised the
capture ceiling to 2576px to match their high-resolution support.
Measured across the 28-photo eval, full set:

| | Sonnet 4.6 | Sonnet 5 |
| --- | --- | --- |
| Precision | 0.970 | **0.984** |
| Recall | 0.987 | **0.993** |
| Phantom extractions | 0 | **0** |

The eval also caught two prompt bugs that had nothing to do with model
tier — both latent ambiguities a more literal model resolved differently.
It emitted placeholder entries ("Untitled Blue Book") for spines it could
see but not read, because "each physical book gets exactly one entry"
preceded the skip rule; and given a photo of vinyl it returned a book
titled "This is not a book, it is a vinyl record collection" rather than
an empty array. Both prompts now say so explicitly. Uncorrected, those
two accounted for the entire apparent regression.

One ground-truth error corrected: `On Bullshit` is genuinely on the
`easy2` / `diagnose` shelf — dim and partly occluded at the top of the
stack — and was being scored as a false positive because the old model
never found it.

### Dependencies

15 vulnerabilities → **0**. `undici` (7 high, via `@vercel/blob`) and
`sharp`, which needed a major bump; its crop pipeline was exercised
against a real photo rather than trusted to semver. Next, React,
lucide-react, Base UI, Playwright, drizzle-kit and Tailwind current.

## 1.1.0 — 2026-05-13

Point release gathering the post-1.0 lookup, export, and mobile-UI
refinements. No DB migrations; safe drop-in upgrade.

### Lookup chain

- Added the **Library of Congress** SRU endpoint as a fourth lookup
  source. LoC is the canonical LCC authority; its values are
  preferred over Open Library when both return. Bumps the LCC
  landing rate noticeably on US-published books.

### CSV export

- LCC now lives only in its dedicated `Library of Congress
  Classification` column; the duplicate `LCC: …` line in Comments
  is gone.

### UI / mobile polish

- Batch hero is decluttered. Refresh and Delete move into a `···`
  overflow menu (Base UI Menu). Quick-fill, Confirm, and Send to
  LibraryThing only render when they actually apply, so an
  empty-or-all-pending batch no longer shows three inert buttons.
- Books section gains a per-list toolbar under the heading: **Select
  all** checkbox and **Expand all / Collapse all** toggle. The
  expand preference persists across visits via localStorage.
- Bulk-action bar at the bottom now shows just the selection count
  plus actions — the select toggle moved up to the Books header
  where it's always visible.
- Re-lookup on the per-book edit form shows a loading toast while
  the lookup chain runs (previously the button appeared to do
  nothing for 5–20 seconds).
- About page footer surfaces the current version.

## 1.0.0 — 2026-05-12

First stable release. Carnegie is ready for the workflow it was built
for: cataloging physical books off photographed shelves, with a
human-in-the-loop review queue and a clean LibraryThing import path.

### Vision pipeline

- Claude Sonnet 4.6 default extraction; confidence-gated escalation
  to Opus 4.7 when any spine reads below 0.7.
- Structured output via tool_use schema — no more loose JSON parsing.
- Anchored confidence rubric and few-shot examples in the prompt.
- Non-book media (vinyl, CDs, DVDs, magazines) explicitly skipped.
- Books returned in left-to-right shelf order so the review queue
  mirrors the physical layout.
- Vision's title and author are authoritative — the lookup chain
  fills metadata around them but never overwrites them.
- 28-photo eval harness with a measured baseline of P=0.97 / R=0.99
  on book photos and 0 phantom extractions on non-book photos.

### Ingest workflows

- Photograph a shelf and analyze.
- Scan a barcode (continuous or single-shot).
- Type an ISBN (Quick Add) or LCCN (Manual).
- Quick-fill ISBNs in bulk for books missing an identifier, with
  continuous barcode scan or keyboard entry.
- Crop & re-read: from the saved photo, draw a rectangle around a
  missed book and fire a targeted Opus extract.

### Lookup chain

- ISBNdb / Open Library / Google Books queried in parallel; best
  fields merged across providers.
- ISBNs the user types or that vision sees on a spine are
  authoritative — never overwritten by chain-derived ISBNs.
- Author-overlap filter rejects wrong-author title-search hits.
- Providers-must-agree gate prevents committing a guessed edition
  ISBN when a title-only search returns disagreeing results.
- LCC probe restores classification landing rate even when ISBNs
  disagree (different editions, same work — LCC is edition-stable).
- Open Library `fields=lcc` explicitly requested (default response
  omits it).
- MARC padding stripped from LCC values
  (`P--0091.00000000.V3 2024` → `P91.V3 2024`).

### Review & export

- Pending review queue surfaces lowest-confidence reads first.
- Bulk-confirm sweeps high-confidence rows in one tap.
- LibraryThing-compatible CSV export with batch name as Collection
  and a dedicated `Library of Congress Classification` column.
- Photos cleared from Vercel Blob automatically when a batch exports.

### Multi-tenancy & security

- Per-user passcode authentication (scrypt with per-row salt).
- HMAC-signed session cookies; 7-day lifetime.
- Per-IP login throttle (10 failures / 5 minutes).
- Every owned-resource route filters by `owner_id`; foreign batches
  return 404 to avoid existence leaks.
- Explicit security headers: CSP, X-Frame-Options, Permissions-Policy,
  Referrer-Policy, X-Content-Type-Options.
- Next.js 16.2.6 (CVE-clean for the App Router middleware bypass).

### UI / identity

- Warm cream-paper light theme; depth via card / background contrast.
- Tartan bookplate, Andrew Carnegie epigraph, printer's-mark footer.
- Dedicated `/guide` quick-reference page; `/about` for identity and
  colophon only.
- PWA installable on iOS and Android via Add to Home Screen.
- Map icon in TopBar for the Guide; Info icon for About.
- Mobile-tuned home page and batch page densities.

### Operator surface

- `USERS.md` (gitignored): user management, passcode rotation,
  database recovery via Neon PITR.
- `TESTER_GUIDE.md` (gitignored): tester onboarding + data-flow
  transparency.
- `COSTS.md` (gitignored): per-book variable cost analysis and
  pricing options.
- Diagnostic scripts under `scripts/` for batch inspection, upload
  health, and LCC backfill.
- Structured JSON logging with request-id propagation through proxy
  to routes.

### Known limitations

- Vision recall on hard-to-photograph shelves (worn spines, glare,
  vertical-text titles) tracks around 90–93%, not 99%. The review
  queue is the safety net.
- Multi-edition title searches without provider agreement won't
  commit an ISBN — the row lands in Quick-fill for the user to
  supply the right one from the back cover. Intentional.
- No in-app password reset; passcode recovery is operator-side via
  the DB.
- Photo storage and the Neon DB are not jointly snapshotted —
  rolling back the DB doesn't roll back Blob photos.
