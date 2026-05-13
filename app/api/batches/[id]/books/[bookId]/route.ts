import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { log, requestIdFrom } from "@/lib/log";
import { processUserIsbn } from "@/lib/lookup/isbn";
import { lookupByIsbn } from "@/lib/lookup";
import { lookupByTitle } from "@/lib/lookup/title";

type RouteContext = { params: Promise<{ id: string; bookId: string }> };

const ActionSchema = z.object({
  _action: z
    .enum([
      "save",
      "delete",
      "permanent-delete",
      "restore",
      "relookup",
      "remove-tag",
    ])
    .optional(),
  title: z.string().trim().min(1).max(1000).optional(),
  authors: z.string().trim().max(1000).optional().nullable(),
  isbn: z.string().trim().max(20).optional().nullable(),
  publisher: z.string().trim().max(200).optional().nullable(),
  pubDate: z.string().trim().max(100).optional().nullable(),
  status: z
    .enum(["pending_review", "confirmed", "rejected"])
    .optional(),
  tag: z.string().trim().max(100).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id, bookId } = await params;
  const requestId = requestIdFrom(request.headers);
  const form = await request.formData();

  // Two _action values may exist (hidden input + button) — last one wins
  // (DOM order). Use getAll so we don't depend on Object.fromEntries quirks.
  const actions = form.getAll("_action").filter((v): v is string => typeof v === "string");
  const action = actions[actions.length - 1] ?? "save";

  const body = { ...Object.fromEntries(form.entries()), _action: action };
  const parsed = ActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();

  // books.owner_id is denormalized off of batches.owner_id at insert time,
  // so per-book ownership checks can filter on books directly without
  // joining batches. Every query below scopes by both bookId and userId.
  const ownerScope = and(
    eq(schema.books.id, bookId),
    eq(schema.books.ownerId, userId),
  );

  // Reject is now a SOFT delete — the row stays, status flips to
  // 'rejected', and the Trash view on the batch page surfaces it for
  // restore-or-permanent-delete. A "save" action with status=rejected
  // gets coerced into the same soft-delete path so legacy callers
  // can't bypass the trash.
  const isSoftDelete = action === "delete" || parsed.data.status === "rejected";

  if (isSoftDelete) {
    const [rejected] = await db
      .update(schema.books)
      .set({ status: "rejected" })
      .where(ownerScope)
      .returning();
    if (!rejected) {
      log("book.action", {
        request_id: requestId,
        user_id: userId,
        batch_id: id,
        book_id: bookId,
        action: "reject",
        outcome: "not_found",
      });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    log("book.action", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      book_id: bookId,
      action: "reject",
      outcome: "ok",
    });
    return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
      status: 303,
    });
  }

  // Permanent delete — hard DB removal, only reachable from the
  // Trash view's "Delete forever" button (which sends
  // _action=permanent-delete explicitly).
  if (action === "permanent-delete") {
    const [removed] = await db
      .delete(schema.books)
      .where(ownerScope)
      .returning({ id: schema.books.id });
    if (!removed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    log("book.action", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      book_id: bookId,
      action: "permanent-delete",
      outcome: "ok",
    });
    return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
      status: 303,
    });
  }

  // Restore — flip a rejected row back to pending_review.
  if (action === "restore") {
    const [restored] = await db
      .update(schema.books)
      .set({ status: "pending_review" })
      .where(ownerScope)
      .returning({ id: schema.books.id });
    if (!restored) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    log("book.action", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      book_id: bookId,
      action: "restore",
      outcome: "ok",
    });
    const redirectUrl = new URL(`/batches/${id}`, request.url);
    redirectUrl.hash = `book-${bookId}`;
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  if (action === "remove-tag") {
    const tag = parsed.data.tag?.trim();
    if (!tag) {
      return NextResponse.json({ error: "Missing tag" }, { status: 400 });
    }
    const [current] = await db
      .select({ tags: schema.books.tags })
      .from(schema.books)
      .where(ownerScope)
      .limit(1);
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const filtered = current.tags.filter((t) => t !== tag);
    await db
      .update(schema.books)
      .set({ tags: filtered })
      .where(ownerScope);
    const redirectUrl = new URL(`/batches/${id}`, request.url);
    redirectUrl.hash = `book-${bookId}`;
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  // Build updates from user-typed fields. Used by both save and relookup;
  // for relookup, the lookup result is layered on top afterwards.
  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.isbn !== undefined) {
    const { isbn13, isbn10 } = processUserIsbn(parsed.data.isbn);
    updates.isbn13 = isbn13;
    updates.isbn10 = isbn10;
  }
  if (parsed.data.publisher !== undefined)
    updates.publisher = parsed.data.publisher || null;
  if (parsed.data.pubDate !== undefined)
    updates.pubDate = parsed.data.pubDate || null;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.authors !== undefined) {
    updates.authors = parsed.data.authors
      ? parsed.data.authors
          .split(/[,\/]/)
          .map((author) => author.trim())
          .filter(Boolean)
      : [];
  }

  const [book] = await db
    .update(schema.books)
    .set(updates)
    .where(ownerScope)
    .returning();

  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action !== "relookup") {
    log("book.action", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      book_id: bookId,
      action: "save",
      outcome: "ok",
    });
    return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
      status: 303,
    });
  }

  // Relookup: try ISBN first, then title+author. The current `book` already
  // reflects the user's edits, so we lookup against their freshly-typed
  // values, not the stale ones.
  const isbnForLookup = book.isbn13 || book.isbn10;
  let result = null;
  let resultSource: string | null = null;
  let usedTitleSearch = false;

  if (isbnForLookup) {
    const outcome = await lookupByIsbn(isbnForLookup);
    if (outcome.result) {
      result = outcome.result;
      resultSource = outcome.result.source;
    }
  }

  if (!result && book.title) {
    // Join all authors into one hint so the guardrail inside lookupByTitle
    // tokenizes across every name (e.g. a co-authored book stays matchable
    // when the provider record happens to list just one co-author).
    const authorHint = book.authors.length > 0 ? book.authors.join(" / ") : null;
    const titleHit = await lookupByTitle(book.title, authorHint);
    if (titleHit) {
      result = titleHit;
      resultSource = titleHit.source;
      usedTitleSearch = true;
    }
  }

  const redirectUrl = new URL(`/batches/${id}`, request.url);

  if (!result) {
    log("book.action", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      book_id: bookId,
      action: "relookup",
      outcome: "miss",
      used_title_search: usedTitleSearch,
    });
    redirectUrl.searchParams.set("relookup", "miss");
    redirectUrl.hash = `book-${book.id}`;
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  // Conservative gap-fill: when the user has typed a value, keep it. The
  // lookup only fills empty fields. Placeholder titles ("Untitled (ISBN
  // …)" / "Untitled (LCCN …)") count as empty so a manual stub gets
  // properly filled in when the lookup finally hits. Tags are still
  // merged additively.
  const mergedTags = mergeTags(book.tags, result.subjects);
  const lookupUpdates: Record<string, unknown> = {};

  if (isPlaceholderTitle(book.title) && result.title) {
    lookupUpdates.title = result.title;
  }
  if (book.authors.length === 0 && result.authors.length > 0) {
    lookupUpdates.authors = result.authors;
  }
  if (!book.publisher && result.publisher) lookupUpdates.publisher = result.publisher;
  if (!book.pubDate && result.pubDate) lookupUpdates.pubDate = result.pubDate;
  if (!book.coverUrl && result.coverUrl) lookupUpdates.coverUrl = result.coverUrl;
  if (!book.lcc && result.lcc) lookupUpdates.lcc = result.lcc;
  if (!book.description && result.description) lookupUpdates.description = result.description;
  if (mergedTags.length !== book.tags.length) lookupUpdates.tags = mergedTags;
  if (!book.isbn13 && result.isbn13) lookupUpdates.isbn13 = result.isbn13;
  if (!book.isbn10 && result.isbn10) lookupUpdates.isbn10 = result.isbn10;

  if (Object.keys(lookupUpdates).length > 0) {
    await db
      .update(schema.books)
      .set(lookupUpdates)
      .where(ownerScope);
  }

  log("book.action", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    book_id: bookId,
    action: "relookup",
    outcome: "hit",
    used_title_search: usedTitleSearch,
    source: resultSource,
    fields_filled: Object.keys(lookupUpdates),
  });

  redirectUrl.searchParams.set("relookup", "hit");
  if (resultSource) redirectUrl.searchParams.set("source", resultSource);
  redirectUrl.hash = `book-${book.id}`;
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

// Stub titles emitted by the manual-add route when a lookup misses but the
// user provided only an identifier. Treated as "empty" by relookup so a
// later lookup hit can fill them in cleanly.
function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  if (/^Untitled \((ISBN|LCCN) /i.test(title)) return true;
  if (title === "Scanned book (lookup failed)") return true;
  return false;
}

// Merge existing book tags with newly-fetched subjects. User-curated tags
// stay, new subjects are appended (deduped), and we cap at 8 so re-lookup
// can't grow tags unboundedly across many runs.
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
