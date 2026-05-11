import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { log, requestIdFrom } from "@/lib/log";
import { processUserIsbn } from "@/lib/lookup/isbn";
import { lookupByIsbn } from "@/lib/lookup";

type RouteContext = { params: Promise<{ id: string }> };

// Each entry is one book to re-lookup. Passing an empty/null isbn means
// "use whatever ISBN the row already has" — the caller can submit a
// no-change row alongside changed ones and it'll still try a lookup.
const UpdateSchema = z.object({
  bookId: z.string().uuid(),
  isbn: z.string().trim().max(20).optional().nullable(),
});
const PayloadSchema = z.object({
  updates: z.array(UpdateSchema).min(1).max(200),
});

type BookRow = typeof schema.books.$inferSelect;

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const requestId = requestIdFrom(request.headers);
  const body = await request.json().catch(() => null);
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();

  // Pull every book in the batch in one query so we can both authorize
  // and gap-fill in memory rather than round-tripping per book. The
  // upper bound is the batch size; tiny compared to the per-book lookup
  // cost.
  const books = await db
    .select()
    .from(schema.books)
    .where(
      and(eq(schema.books.batchId, id), eq(schema.books.ownerId, userId)),
    );
  const byId = new Map<string, BookRow>(books.map((b) => [b.id, b]));

  // Filter out IDs that don't belong to this user's batch. We don't 403 on
  // a partial mismatch — silently skip and report counts. Foreign IDs
  // never leak existence.
  const valid = parsed.data.updates.filter((u) => byId.has(u.bookId));

  // Run all lookups in parallel. Each result is { update, book, lookup }
  // so we can apply the gap-fill in a single batched write per book.
  const results = await Promise.all(
    valid.map(async (u) => {
      const book = byId.get(u.bookId)!;
      // 1. If user typed a new ISBN, derive isbn13/isbn10. Otherwise keep
      //    whatever the row already has.
      const { isbn13: typedIsbn13, isbn10: typedIsbn10 } = processUserIsbn(u.isbn);
      const newIsbn13 = typedIsbn13 ?? book.isbn13;
      const newIsbn10 = typedIsbn10 ?? book.isbn10;
      const isbnForLookup = newIsbn13 || newIsbn10;

      let lookup = null;
      if (isbnForLookup) {
        const outcome = await lookupByIsbn(isbnForLookup);
        lookup = outcome.result;
      }

      return { update: u, book, newIsbn13, newIsbn10, lookup };
    }),
  );

  // Apply gap-fill writes serially. Drizzle's neon-http driver doesn't
  // support transactions over HTTP, but each book's update is independent
  // — interleaved order doesn't matter.
  let hits = 0;
  let misses = 0;
  for (const r of results) {
    const updates: Partial<BookRow> = {};
    // Always persist the new ISBN forms (the user-typed input is the
    // authoritative path, matching Fix 1 + Fix 2).
    if (r.newIsbn13 !== r.book.isbn13) updates.isbn13 = r.newIsbn13;
    if (r.newIsbn10 !== r.book.isbn10) updates.isbn10 = r.newIsbn10;

    if (r.lookup) {
      hits++;
      // Conservative gap-fill — matches the single-book re-lookup logic.
      if (isPlaceholderTitle(r.book.title) && r.lookup.title) {
        updates.title = r.lookup.title;
      }
      if (r.book.authors.length === 0 && r.lookup.authors.length > 0) {
        updates.authors = r.lookup.authors;
      }
      if (!r.book.publisher && r.lookup.publisher) updates.publisher = r.lookup.publisher;
      if (!r.book.pubDate && r.lookup.pubDate) updates.pubDate = r.lookup.pubDate;
      if (!r.book.coverUrl && r.lookup.coverUrl) updates.coverUrl = r.lookup.coverUrl;
      if (!r.book.lcc && r.lookup.lcc) updates.lcc = r.lookup.lcc;
      if (!r.book.description && r.lookup.description) {
        updates.description = r.lookup.description;
      }
      const mergedTags = mergeTags(r.book.tags, r.lookup.subjects);
      if (mergedTags.length !== r.book.tags.length) updates.tags = mergedTags;
    } else if (r.update.isbn) {
      // User typed an ISBN, lookup missed. Still persist the ISBN — that's
      // the user's source-of-truth answer; future re-lookup may hit.
      misses++;
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.books)
        .set(updates)
        .where(
          and(eq(schema.books.id, r.book.id), eq(schema.books.ownerId, userId)),
        );
    }
  }

  log("book.bulk_relookup", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    submitted: parsed.data.updates.length,
    valid: valid.length,
    hits,
    misses,
  });

  return NextResponse.json({
    submitted: parsed.data.updates.length,
    valid: valid.length,
    hits,
    misses,
  });
}

function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  if (/^Untitled \((ISBN|LCCN) /i.test(title)) return true;
  if (title === "Scanned book (lookup failed)") return true;
  return false;
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...existing, ...incoming]) {
    const k = t.trim();
    if (!k) continue;
    const lk = k.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(k);
    if (out.length >= 8) break;
  }
  return out;
}
