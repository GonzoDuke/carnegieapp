import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { processUserIsbn } from "@/lib/lookup/isbn";
import { lookupByIsbn } from "@/lib/lookup";
import { lookupByLccn, normalizeLccn } from "@/lib/lookup/lccn";

type RouteContext = { params: Promise<{ id: string }> };

// At least one of {title, isbn, lccn} must be present. ISBN runs the full
// three-provider lookup chain; LCCN is OL-only (the only provider that
// indexes by it) and used as a fallback for older books without ISBNs.
// Title alone makes a manual stub.
const CreateBookSchema = z
  .object({
    title: z.string().trim().max(1000).optional().nullable(),
    authors: z.string().trim().max(1000).optional().nullable(),
    isbn: z.string().trim().max(20).optional().nullable(),
    lccn: z.string().trim().max(30).optional().nullable(),
    publisher: z.string().trim().max(200).optional().nullable(),
    pubDate: z.string().trim().max(100).optional().nullable(),
  })
  .refine(
    (data) => Boolean(data.title?.trim() || data.isbn?.trim() || data.lccn?.trim()),
    {
      message: "Provide a title, ISBN, or LCCN.",
      path: ["title"],
    },
  );

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const body = await readJsonOrForm(request);
  const parsed = CreateBookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Verify the batch belongs to the current user before inserting a book
  // into it. 404 (not 403) so foreign batch IDs don't leak existence.
  const db = getDb();
  const [batch] = await db
    .select({ id: schema.batches.id })
    .from(schema.batches)
    .where(and(eq(schema.batches.id, id), eq(schema.batches.ownerId, userId)))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = parsed.data;
  const userTitle = data.title?.trim() || "";
  const userAuthorList = data.authors
    ? data.authors
        .split(/[,\/]/)
        .map((author) => author.trim())
        .filter(Boolean)
    : [];

  // Lookup precedence: ISBN (full three-provider chain) → LCCN
  // (OL-only). The first one that returns a result wins; we don't merge
  // both because the user only filled one input in the typical case.
  let lookup = data.isbn ? (await lookupByIsbn(data.isbn)).result : null;
  let lookupKind: "isbn" | "lccn" | null = lookup ? "isbn" : null;
  if (!lookup && data.lccn?.trim()) {
    lookup = await lookupByLccn(data.lccn);
    if (lookup) lookupKind = "lccn";
  }

  const { isbn13: typedIsbn13, isbn10: typedIsbn10 } = processUserIsbn(data.isbn);

  // Layer: lookup fills gaps, user-typed values override.
  const finalTitle =
    userTitle ||
    lookup?.title ||
    (data.isbn
      ? `Untitled (ISBN ${data.isbn.trim()})`
      : data.lccn
        ? `Untitled (LCCN ${normalizeLccn(data.lccn)})`
        : "");
  const finalAuthors =
    userAuthorList.length > 0 ? userAuthorList : lookup?.authors ?? [];
  const finalPublisher = data.publisher?.trim() || lookup?.publisher || null;
  const finalPubDate = data.pubDate?.trim() || lookup?.pubDate || null;
  // User-typed ISBN is authoritative — the chain may return a different
  // edition's ISBN for the same title, but the user has the book in hand
  // and gave us this specific identifier. Only fall back to the chain's
  // ISBN when the user didn't provide one.
  const finalIsbn13 = typedIsbn13 || lookup?.isbn13 || null;
  const finalIsbn10 = typedIsbn10 || lookup?.isbn10 || null;
  const finalCoverUrl = lookup?.coverUrl ?? null;
  const finalTags = lookup?.subjects ?? [];
  const finalLcc = lookup?.lcc ?? null;
  const finalDescription = lookup?.description ?? null;

  // Lookup-missed stubs go to pending review with a note pointing at the
  // identifier we couldn't resolve, so they stand out from clean inserts.
  const lookupMissed =
    !lookup && !userTitle && (Boolean(data.isbn) || Boolean(data.lccn));
  const status: "confirmed" | "pending_review" = lookupMissed
    ? "pending_review"
    : "confirmed";
  const comments = lookupMissed
    ? data.isbn
      ? `Manual entry. ISBN ${data.isbn.trim()} not found in lookup chain.`
      : `Manual entry. LCCN ${normalizeLccn(data.lccn ?? "")} not found in Open Library.`
    : null;

  const [book] = await db
    .insert(schema.books)
    .values({
      ownerId: userId,
      batchId: id,
      source: "manual",
      status,
      title: finalTitle,
      authors: finalAuthors,
      isbn13: finalIsbn13,
      isbn10: finalIsbn10,
      publisher: finalPublisher,
      pubDate: finalPubDate,
      coverUrl: finalCoverUrl,
      tags: finalTags,
      lcc: finalLcc,
      description: finalDescription,
      comments,
    })
    .returning();

  if (request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.json({ book, lookup, lookupKind }, { status: 201 });
  }

  const redirectUrl = new URL(`/batches/${id}`, request.url);
  if (lookup) {
    redirectUrl.searchParams.set("manual", "hit");
    redirectUrl.searchParams.set("source", lookup.source);
  } else if (lookupMissed) {
    redirectUrl.searchParams.set("manual", "miss");
  }
  redirectUrl.hash = `book-${book.id}`;
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

async function readJsonOrForm(request: NextRequest): Promise<unknown> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
