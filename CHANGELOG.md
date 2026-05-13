# Changelog

Carnegie — a personal-library cataloger. Photograph shelves, scan
barcodes, type ISBNs; export LibraryThing-compatible CSV.

## Unreleased

Post-1.0 improvements gathered for the next point release.

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
