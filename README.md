# Zippy Planet

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
- **Phase 2 — Lookup library:** ISBN normalization + ISBNdb / Open Library / Google Books / LibraryThing.
- **Phase 3 — Barcode flow:** `@zxing/browser` scanner.
- **Phase 4 — Vision flow:** Claude vision → per-book lookup → review queue.
- **Phase 5 — Review UI:** confirm / edit / reject per book.
- **Phase 6 — CSV export:** LibraryThing import format.
- **Phase 7 — PWA polish:** manifest, icons, offline shell, daily cost cap.

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
