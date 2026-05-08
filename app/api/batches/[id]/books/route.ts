import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { processUserIsbn } from "@/lib/lookup/isbn";
import { lookupByIsbn } from "@/lib/lookup";

type RouteContext = { params: Promise<{ id: string }> };

// Either a title or an ISBN must be present. With an ISBN we can fill in the
// rest via lookup; with a title the user is creating a stub manually.
const CreateBookSchema = z
  .object({
    title: z.string().trim().max(1000).optional().nullable(),
    authors: z.string().trim().max(1000).optional().nullable(),
    isbn: z.string().trim().max(20).optional().nullable(),
    publisher: z.string().trim().max(200).optional().nullable(),
    pubDate: z.string().trim().max(100).optional().nullable(),
  })
  .refine((data) => Boolean(data.title?.trim() || data.isbn?.trim()), {
    message: "Provide either a title or an ISBN.",
    path: ["title"],
  });

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const body = await readJsonOrForm(request);
  const parsed = CreateBookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const userTitle = data.title?.trim() || "";
  const userAuthorList = data.authors
    ? data.authors
        .split(/[,\/]/)
        .map((author) => author.trim())
        .filter(Boolean)
    : [];

  // Run the lookup chain whenever an ISBN is present. The user's typed
  // values still take precedence below — lookup only fills in gaps.
  const lookup = data.isbn ? (await lookupByIsbn(data.isbn)).result : null;

  const { isbn13: typedIsbn13, isbn10: typedIsbn10 } = processUserIsbn(data.isbn);

  // Layer: lookup fills gaps, user-typed values override.
  const finalTitle =
    userTitle ||
    lookup?.title ||
    (data.isbn ? `Untitled (ISBN ${data.isbn.trim()})` : "");
  const finalAuthors =
    userAuthorList.length > 0 ? userAuthorList : lookup?.authors ?? [];
  const finalPublisher = data.publisher?.trim() || lookup?.publisher || null;
  const finalPubDate = data.pubDate?.trim() || lookup?.pubDate || null;
  const finalIsbn13 = lookup?.isbn13 || typedIsbn13;
  const finalIsbn10 = lookup?.isbn10 || typedIsbn10;
  const finalCoverUrl = lookup?.coverUrl ?? null;
  const finalTags = lookup?.subjects ?? [];
  const finalLcc = lookup?.lcc ?? null;
  const finalDescription = lookup?.description ?? null;

  // If user typed only an ISBN and lookup missed, the row is a stub —
  // leave it pending review with a comment so it stands out.
  const isbnOnlyMissed = data.isbn && !lookup && !userTitle;
  const status: "confirmed" | "pending_review" = isbnOnlyMissed
    ? "pending_review"
    : "confirmed";
  const comments = isbnOnlyMissed
    ? `Manual entry. ISBN ${data.isbn?.trim()} not found in lookup chain.`
    : null;

  const db = getDb();
  const [book] = await db
    .insert(schema.books)
    .values({
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
    return NextResponse.json({ book, lookup }, { status: 201 });
  }

  const redirectUrl = new URL(`/batches/${id}`, request.url);
  if (lookup) {
    redirectUrl.searchParams.set("manual", "hit");
    redirectUrl.searchParams.set("source", lookup.source);
  } else if (isbnOnlyMissed) {
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
