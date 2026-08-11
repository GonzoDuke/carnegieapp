# Carnegie

Catalog physical books fast: photograph shelves → AI reads the spines → barcode-scan or type in the rest → review → export CSV.

Carnegie is an **intake tool**. It gets books off a shelf and into structured data as quickly as a human can review them, then hands off a clean CSV. It deliberately stops there: browsing, searching, and making decisions about a collection over time belong to Frick, its companion app.

Next.js 16 App Router on Vercel, Neon Postgres + Drizzle, Vercel Blob for photos, Claude vision. Installs as a PWA on iOS and Android.

## Accounts

Each person (or shared context) gets their own account, authenticated by passcode only — no email, no signup flow. Passcodes are scrypt-hashed with a per-row salt; sessions are HMAC-signed cookies with a 7-day lifetime, verified without a database lookup.

Every owned row carries an `owner_id`, and every route filters on it. A batch belonging to another account returns 404 rather than 403, so account contents can't be probed.

Accounts are created operator-side — there is no self-registration and no in-app password reset. See `scripts/add-user.mjs`.

## Setup

### 1. Provision Neon Postgres

Either add a Neon database from the Vercel dashboard (Storage → Neon) and copy the `DATABASE_URL` it gives you, or sign up at [neon.tech](https://neon.tech) directly and copy the pooled connection string.

### 2. Create `.env.local`

| Variable | Required | What it's for |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string |
| `APP_AUTH_SECRET` | yes | Signs session cookies. `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | for photos | Spine extraction. Barcode and manual entry work without it |
| `BLOB_READ_WRITE_TOKEN` | for photos | Vercel Blob, for storing source images |
| `ISBNDB_API_KEY` | optional | Paid lookup provider, preferred when present |
| `GOOGLE_BOOKS_API_KEY` | optional | Raises Google Books rate limits; the API works unkeyed |

Open Library and the Library of Congress need no key.

### 3. Create the schema and a user

```bash
npm run db:push
node scripts/add-user.mjs "Your Name" <passcode>
```

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign in, create a batch.

## How it works

**Batches** are units of intake — one shelf, one cart, one box. A batch has a name, a location, and optional notes, all of which carry through to the export.

**Three ways in.** Photograph a shelf and Claude extracts every readable spine (15–25 books in 15–30 seconds); scan a back-cover barcode; or type an ISBN or LCCN. However a book arrives, it's looked up across ISBNdb, Open Library, Google Books, and the Library of Congress in parallel, and the best fields are merged.

**Review is mandatory.** Photographed books land as `pending_review` with a confidence dot. Bulk-confirm sweeps everything above 0.85 in one tap; the rest get confirmed, edited, re-looked-up, or rejected individually. Vision's title and author are authoritative — the lookup chain fills in around them and never overwrites them.

**Export is a pure read.** Downloading the CSV changes nothing, so you can pull the same batch as many times as the work needs. Filing a batch into the Archive is a separate, reversible action ("Mark complete" on the batch page).

**Photos persist** with their batch until the batch is deleted. Label the box a photo shows and every book it found inherits that label.

## Relationship to Frick

Frick is a separate read-mostly app over the same Neon database: cross-batch search, call-number order, per-book decisions, and a public finding aid. It reads Carnegie's tables and writes only its own, in a separate `shelflist` Postgres schema, using a database role with no write access to anything here.

Two consequences for this repo:

- `drizzle.config.ts` sets `schemaFilter` and `tablesFilter`. Without them, `db:push` would see Frick's tables as deleted and propose dropping them. Don't remove those lines.
- `books.upload_id` links a book to its source photo. Frick joins through it to read the current box label, so a book has a physical address finer than its batch.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test:e2e     # Playwright smoke test (needs a running server + E2E_PIN)
npm run db:push      # sync schema to DB — prompts before destructive changes
npm run db:studio    # browse the DB
npm run eval:vision  # run the 28-photo extraction eval against eval/truth
```

## Limits worth knowing

- **200 photo extractions per user per day** (UTC). Barcode scans and manual entries don't count against it.
- **Vision recall is 90–93% on difficult shelves** — worn spines, glare, vertical text. The review queue is the safety net, and "crop & re-read" targets anything missed.
- **Title-only searches won't commit an ISBN** unless providers agree. Those books land in Quick-fill for you to supply the right one from the back cover. Intentional — a guessed edition is worse than a blank.
- **Photos and the database aren't snapshotted together.** Rolling back the DB via Neon PITR doesn't roll back Blob images.

See `CHANGELOG.md` for release history.
