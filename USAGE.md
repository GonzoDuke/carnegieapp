# Cataloging your library with Zippy Planet

This guide walks through the most efficient way to catalog a personal library
end-to-end — from a box of books on the floor to a clean CSV imported into
LibraryThing. It covers the three input methods (photo, barcode, manual),
when to use which, and the specific photo-quality choices that maximize the
vision model's accuracy.

## The big picture

For most personal libraries, the fastest path looks like this:

1. **Group books physically.** One batch = one shelf, one stack, or one box.
   Mixing across locations makes review harder.
2. **Photograph each shelf** — one image per shelf row, taken with care.
   Vision will extract the books in 15–30 seconds.
3. **Bulk-confirm the high-confidence rows** (one click).
4. **Hand-review the rest** — edit obvious misreads, re-lookup, or reject.
5. **Barcode-scan anything vision missed** (usually 1–3 books per shelf).
6. **Export the batch** as a LibraryThing-format CSV when you're done.

A 30-book shelf typically takes 2–4 minutes end-to-end.

## Setting up a batch

Create batches with both a **name** and a **location**:

- **Name**: a short, unique identifier — e.g. `Box 4`, `Office shelf 2`,
  `Cookbooks`.
- **Location**: where this batch lives physically — e.g. `Garage`,
  `Living room`, `Storage unit B`.

The location flows into your CSV's `Comments` column as `Location: <value>`,
so when you scroll your LibraryThing collection later you can see where each
book physically lives. The name becomes a tag, so you can filter your
LibraryThing collection by batch.

## Method 1 — Photo (the workhorse)

This is the biggest time-saver. You take one photo and Claude extracts every
book in it. Then each detected book is auto-looked-up against ISBNdb, Open
Library, and Google Books.

### Photo specs

The app resizes every image to **2048 pixels on the long edge** before
sending to the vision model. Everything below is calibrated to that.

#### How many books per image

**Target: 15–25 books per image. Soft ceiling: 30. Hard floor: 5.**

Why: at 2048px long edge, each spine needs to be at least ~50px wide for the
model to read its text reliably. With 30 books fanned across the long edge
you're at ~68px per spine — usable. At 50 books you're at ~40px, and
accuracy drops sharply because the spine text becomes too small.

If a shelf has 40+ books, **split it into two photos** rather than trying to
fit everything in one frame. Better to spend two vision calls and get clean
extraction than one call with half the books unreadable.

#### Orientation: spines vertical or horizontal?

**Hold your phone in landscape (wide) mode and shoot the shelf so the spines
appear vertical in the photo** — i.e., the same way you'd see them standing
in front of the bookcase.

- **Landscape phone orientation** matches the aspect ratio of a typical
  shelf (wider than tall), so each spine gets roughly equal pixel real
  estate.
- **Spines vertical in the frame** is what the model expects. It can read
  rotated text, but spine titles in Western books are usually printed
  bottom-to-top — keeping that orientation lines up with how the model is
  trained to read book photos.

**Don't tilt the camera 90°** to make spines horizontal. The image will
process the same, but you'll fit fewer books in the frame and each spine
will be narrower in pixels.

#### Distance and angle

- Stand back enough that the entire shelf row is in frame with a small
  margin on either side. Cropping spines off the edges loses books.
- Camera roughly **perpendicular to the spines**, not angled. Tilted shots
  distort the lettering and lower confidence.
- Avoid leaning over or shooting up — keep the camera at the same height as
  the shelf.

#### Lighting

- **Use ambient room light** (overhead or window).
- **Don't use flash** — it creates a hot spot in the middle of the photo
  that wipes out spine text in a wide arc.
- **Don't shoot through glass** unless you can avoid reflections. Open the
  cabinet door if you can.

#### Spines that won't extract well

The model will skip or low-confidence rows on:

- Worn / faded spines where the title is barely legible
- Books lying flat with no spine visible (it's working from spines only)
- Small format books with very small spine text
- Spines with all-graphic covers (no text)

These are normal cases for hand entry or barcode scanning afterward.

### After the photo

You'll see a toast like *"Detected 22 books · added 22 to review."* Each
book lands in the list with status `pending review` and a colored confidence
dot:

- 🟢 **Green dot (≥0.85)**: high confidence, the model is sure
- 🟡 **Amber dot (0.5–0.84)**: medium, worth a glance
- 🔴 **Red dot (<0.5)**: low, will likely need editing

Click **Confirm N (≥0.85)** in the batch toolbar to one-shot promote all
green-dot books to confirmed. Then walk down the amber/red rows and:

- Click a row to expand it
- Either fix the title/ISBN by hand and click **Re-lookup** to refresh
  metadata
- Or click **Confirm** if it's already correct
- Or click **Reject** if it's a misread (e.g., the model invented a book)

## Method 2 — Barcode scan

Best for: filling in books that vision missed, or when you want to catalog a
single book without taking a photo. Also good for verifying ISBNs.

1. Open the **Scan** tab on a batch page.
2. Tap **Scan barcode** — your phone prompts for camera permission (allow).
3. Hold the phone over the **back-cover barcode** of a book. Keep it steady;
   the scanner reads EAN-13.
4. On a successful read you'll see a toast with the matched title.

**Note**: barcode scanning needs HTTPS. The deployed Vercel URL works on any
phone. Local dev only works on `localhost` (your laptop), not over LAN.

If a barcode reads but the lookup misses (rare, only for niche books), the
row is added to your queue with a placeholder title. Fix the ISBN manually
or use **Re-lookup**.

## Method 3 — Manual entry

Best for: books with no barcode (very old books), or when you have the ISBN
written down somewhere.

The Manual tab puts ISBN at the top because **just typing an ISBN is
enough** — title, author, publisher, and cover all auto-fill from the
lookup chain.

- ISBN-10 or ISBN-13 both work, with or without hyphens.
- If you don't have an ISBN, expand "No ISBN? Enter details manually" and
  type title + author by hand.
- The book is saved as `confirmed` if lookup succeeds or you typed a title;
  saved as a draft (`pending review`) if lookup fails on an ISBN-only entry.

## Re-lookup — when to use it

Anywhere you see a book row with bad metadata (wrong title, missing cover,
no author), expand it and click the **✨ Re-lookup** button. This:

1. Saves whatever you typed into the form
2. Re-runs the lookup chain on the now-current ISBN (or title+author if no
   ISBN)
3. Replaces the metadata with what comes back

Use this whenever you've fixed a misread ISBN or corrected a title — it
will fill in the rest from the canonical source.

## Bulk confirm — when to use it

Right after a photo extraction. The button only appears when there's at
least one pending row with confidence ≥ 0.85.

What it does: flips every pending book that has a confidence ≥ 0.85 to
`confirmed` in one click. Manual and barcode books (which have no
confidence score) are never touched by bulk confirm — they stay where they
are.

## Reviewing efficiently

- Rejected books are **hidden by default**. Toggle "Show rejected" if you
  want to see or recover them.
- The cover thumbnail next to each row is your fastest sanity check. If the
  cover doesn't match what's in your hand, the metadata is wrong.
- For vision-extracted rows, the confidence dot (🟢🟡🔴) tells you which
  rows need scrutiny.

## Exporting to LibraryThing

When all the books in a batch are `confirmed` (or rejected — those are
excluded), click **Export (N)** in the batch toolbar. You'll get a CSV named
something like `garage-box-4-2026-05-08.csv` with columns matching
LibraryThing's import format:

- ISBN, Title, Author, Publisher, Date, Tags, Collections, Comments
- Tags: includes the batch name automatically
- Comments: includes `Location: <your location>` if set, plus any per-book
  notes

In LibraryThing: **Tools → Import Books → Upload CSV**. Map columns when
prompted (it usually auto-detects).

**Strongly recommended**: do a small test batch (5 books) and import it to
LibraryThing first to confirm the round-trip works on your account before
processing a 200-book backlog.

## Daily limits and cost

- The vision pipeline has a hard cap of **200 photo extractions per UTC
  day** (configurable via `VISION_DAILY_LIMIT`). The current usage shows in
  the page footer.
- Barcode scans, manual entries, and re-lookups don't count against this
  cap. Only the photo-extract action does.
- If you hit the cap mid-session, scan barcodes or come back tomorrow.

## Workflow recipes

### A box from the attic (50–80 books)

1. Create batch `Box 4` with location `Attic`.
2. Spread the books spine-up on the floor in 3 rows of ~20.
3. Take one photo per row (3 photos total).
4. Bulk confirm high-confidence books.
5. Hand-review the rest — should take 5–10 minutes.
6. Barcode any books that vision missed (usually 2–4 per box).
7. Export.

### A bookshelf in the living room (200 books)

1. Create one batch per shelf (e.g. `Living room shelf 1` … `shelf 6`).
2. Photograph each shelf as a separate batch — easier to track and review.
3. Repeat the recipe above per batch.

### A single book in a coffee shop

1. Use any existing batch or create one called `Loose books`.
2. Open the Scan or Manual tab.
3. Scan the barcode or type the ISBN.

## Troubleshooting

**Vision detected fewer books than I see in the photo**
The model skips books it can't read confidently. Either zoom in (split the
shelf into two photos) or barcode-scan the missing ones.

**Vision misread a title (close but wrong)**
Open the row, fix the title, click **Re-lookup**. The lookup chain will
match the corrected title against Google Books.

**Cover image is missing or wrong**
The cover follows the metadata. Re-lookup after fixing the ISBN/title and
the cover usually catches up. The fallback chain tries Open Library by
ISBN-13, then ISBN-10, then a styled placeholder.

**Barcode scan fails on a specific book**
Some older books have only ISBN-10 in barcode form, or non-standard
encodings. Type the ISBN into the Manual tab instead.

**LibraryThing import rejects my CSV**
Send me an example of what it complained about — the column headers may
need a small tweak. Until then, you can manually adjust columns at
import-time in LibraryThing.

## What's intentionally simple

- One passcode for the whole app. No accounts.
- No automatic deduplication — if you photograph the same shelf twice you
  get duplicate rows. Either be careful, or use the per-row Delete button.
- No undo on delete. Confirm dialogs are the only safety net.
- The Anthropic key, ISBNdb key, and Google Books key are required for the
  full experience. Open Library works without keys.
