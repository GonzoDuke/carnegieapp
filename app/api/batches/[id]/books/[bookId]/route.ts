import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { processUserIsbn } from "@/lib/lookup/isbn";
import { lookupByIsbn } from "@/lib/lookup";
import { lookupByTitle } from "@/lib/lookup/title";

type RouteContext = { params: Promise<{ id: string; bookId: string }> };

const ActionSchema = z.object({
  _action: z.enum(["save", "delete", "relookup", "remove-tag"]).optional(),
  title: z.string().trim().min(1).max(1000).optional(),
  authors: z.string().trim().max(1000).optional().nullable(),
  isbn: z.string().trim().max(20).optional().nullable(),
  publisher: z.string().trim().max(200).optional().nullable(),
  pubDate: z.string().trim().max(100).optional().nullable(),
  // "rejected" is accepted purely so legacy clients still work — it's
  // treated as a delete below. New code should send action=delete instead.
  status: z
    .enum(["pending_review", "confirmed", "rejected"])
    .optional(),
  tag: z.string().trim().max(100).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id, bookId } = await params;
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

  // Reject = delete. If a save action arrives with status=rejected, treat it
  // as a delete so we never persist that status.
  const isDelete = action === "delete" || parsed.data.status === "rejected";

  // books.owner_id is denormalized off of batches.owner_id at insert time,
  // so per-book ownership checks can filter on books directly without
  // joining batches. Every query below scopes by both bookId and userId.
  const ownerScope = and(
    eq(schema.books.id, bookId),
    eq(schema.books.ownerId, userId),
  );

  if (isDelete) {
    const [deleted] = await db
      .delete(schema.books)
      .where(ownerScope)
      .returning();
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
      status: 303,
    });
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

  if (isbnForLookup) {
    const outcome = await lookupByIsbn(isbnForLookup);
    if (outcome.result) {
      result = outcome.result;
      resultSource = outcome.result.source;
    }
  }

  if (!result && book.title) {
    const titleHit = await lookupByTitle(book.title, book.authors[0] ?? null);
    if (titleHit) {
      result = titleHit;
      resultSource = titleHit.source;
    }
  }

  const redirectUrl = new URL(`/batches/${id}`, request.url);

  if (!result) {
    redirectUrl.searchParams.set("relookup", "miss");
    redirectUrl.hash = `book-${book.id}`;
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  // Layer lookup result on top of user's edits. Only fields that the lookup
  // confidently provides get overwritten; status and comments stay.
  // Tags are merged with existing — re-lookup adds subject tags from the
  // new provider on top of any user-curated ones, deduped and capped.
  const mergedTags = mergeTags(book.tags, result.subjects);
  const lookupUpdates: Record<string, unknown> = {
    title: result.title || book.title,
    authors: result.authors.length ? result.authors : book.authors,
    publisher: result.publisher ?? book.publisher,
    pubDate: result.pubDate ?? book.pubDate,
    coverUrl: result.coverUrl ?? book.coverUrl,
    tags: mergedTags,
    lcc: result.lcc ?? book.lcc,
    description: result.description ?? book.description,
  };
  if (result.isbn13) lookupUpdates.isbn13 = result.isbn13;
  if (result.isbn10) lookupUpdates.isbn10 = result.isbn10;

  await db
    .update(schema.books)
    .set(lookupUpdates)
    .where(ownerScope);

  redirectUrl.searchParams.set("relookup", "hit");
  if (resultSource) redirectUrl.searchParams.set("source", resultSource);
  redirectUrl.hash = `book-${book.id}`;
  return NextResponse.redirect(redirectUrl, { status: 303 });
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
