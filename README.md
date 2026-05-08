# Carnegie

Catalog physical books fast: photograph shelves → AI extracts spines → barcode-scan the rest → export a LibraryThing-compatible CSV.

Single-user PWA. Next.js 16 App Router on Vercel, Neon Postgres + Drizzle, Claude vision.

## Setup

### 1. Provision Neon Postgres

- Easiest: Vercel dashboard → Storage → add a Neon database. Paste the `DATABASE_URL` it gives you.
- Or sign up at [neon.tech](https://neon.tech) (free tier is plenty) and copy the pooled connection string.

### 2. Create `.env.local`

```bash
cp .env.local.example .env.local
```

Fill in:
- `DATABASE_URL` — from step 1
- `APP_PASSCODE` — any long random string. This is the single shared password to enter the app.

You can leave `ISBNDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`, and `ANTHROPIC_API_KEY` empty until later phases.

### 3. Push the schema

```bash
npm run db:push
```

This creates the `batches` and `books` tables in your Neon database.

### 4. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>, enter your passcode, create a batch.

## Phase status

- **Phase 1 — Skeleton:** ✅ Next.js scaffold, Neon + Drizzle, passcode auth, batch CRUD UI.
- **Phase 2 — Lookup library:** ✅ ISBN normalization + ISBNdb → Open Library / Google Books chain. Debug at `/lookup`.
- **Phase 3 — Barcode flow:** ✅ `@zxing/browser` scanner wired through the lookup chain — scans become real metadata.
- **Phase 4 — Vision flow:** ✅ Photo a shelf → Claude Sonnet 4.6 extracts books with prompt caching → per-book lookup (ISBN if visible, else title+author search) → review queue. UTC daily cap surfaced in the page footer.
- **Phase 5 — Review UI:** ✅ Per-book Save edits / Confirm / Reject + bulk "Confirm N (≥0.85)" for high-confidence vision results.
- **Phase 6 — CSV export:** ✅ LibraryThing import format. Export button on the batch page; only confirmed books are exported, batch name auto-tagged.
- **Phase 7 — PWA polish:** ✅ Web manifest, generated icons (browser favicon + iOS apple-touch-icon + maskable SVG), Apple home-screen meta tags, daily cost cap surfaced in the page footer. Add to Home Screen on iOS / Install on Android both work.

See `~/.claude/plans/i-want-to-make-zippy-planet.md` for the full plan.

## Useful commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run db:push      # sync schema to DB (no migration files)
npm run db:generate  # generate SQL migration from schema diff
npm run db:studio    # browse the DB in a local GUI
```
