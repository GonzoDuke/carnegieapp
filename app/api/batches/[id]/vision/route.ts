import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { extractBooksFromImage, type VisionBook } from "@/lib/vision";
import { lookupByIsbn } from "@/lib/lookup";
import { lookupByTitle } from "@/lib/lookup/title";
import { getBudget, incrementUsage } from "@/lib/vision-budget";

type RouteContext = { params: Promise<{ id: string }> };

// Larger body for image uploads — default Vercel function limit (4.5MB) is
// already enough for our compressed JPEGs, but extending the timeout helps
// because vision calls can take 15–30s.
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const db = getDb();
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, id))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  // Pre-flight budget check (cheap). The actual decrement happens after we
  // commit to spending the call.
  const preflight = await getBudget();
  if (preflight.exhausted) {
    return NextResponse.json(
      {
        error: `Daily vision budget exhausted (${preflight.used}/${preflight.limit}). Try again tomorrow or raise VISION_DAILY_LIMIT.`,
        budget: preflight,
      },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
  }

  const mediaType = pickMediaType(file.type);
  if (!mediaType) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}` },
      { status: 415 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");

  // Reserve the budget slot before calling Claude. If the call fails, this
  // slot is already spent — that's intentional: we don't want a flaky vision
  // call to look free.
  const budget = await incrementUsage();

  let extraction;
  try {
    extraction = await extractBooksFromImage(base64, mediaType);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        budget,
      },
      { status: 502 },
    );
  }

  if (extraction.books.length === 0) {
    return NextResponse.json({
      summary: { detected: 0, inserted: 0, budget },
      books: [],
      raw: extraction.raw,
    });
  }

  // For each detected book, try to upgrade to canonical metadata.
  const enriched = await Promise.all(
    extraction.books.map((book) => enrichDetected(book)),
  );

  const inserted = await db
    .insert(schema.books)
    .values(
      enriched.map(({ book, lookup }) => ({
        batchId: id,
        source: "vision" as const,
        // Vision results always go through review — even high-confidence ones,
        // because misreads on spines are common and a wrong row in the export
        // is worse than 5 seconds of confirmation.
        status: "pending_review" as const,
        isbn13: lookup?.isbn13 ?? null,
        isbn10: lookup?.isbn10 ?? null,
        title: lookup?.title || book.title,
        authors: lookup?.authors?.length
          ? lookup.authors
          : book.author
            ? [book.author]
            : [],
        publisher: lookup?.publisher ?? null,
        pubDate: lookup?.pubDate ?? null,
        coverUrl: lookup?.coverUrl ?? null,
        tags: lookup?.subjects ?? [],
        lcc: lookup?.lcc ?? null,
        description: lookup?.description ?? null,
        confidence: book.confidence,
        rawVision: { vision: book, lookupSource: lookup?.source ?? null },
      })),
    )
    .returning();

  return NextResponse.json({
    summary: {
      detected: extraction.books.length,
      inserted: inserted.length,
      budget,
      tokens: extraction.usage,
    },
    books: inserted,
  });
}

async function enrichDetected(book: VisionBook) {
  // If the model spotted an ISBN, use the existing chain — much higher quality.
  if (book.visible_isbn) {
    const outcome = await lookupByIsbn(book.visible_isbn);
    if (outcome.result) return { book, lookup: outcome.result };
  }
  // Otherwise try a title+author search against Google Books.
  const fromTitle = await lookupByTitle(book.title, book.author);
  return { book, lookup: fromTitle };
}

function pickMediaType(
  contentType: string,
): "image/jpeg" | "image/png" | "image/webp" | null {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "image/jpeg";
  if (contentType.includes("png")) return "image/png";
  if (contentType.includes("webp")) return "image/webp";
  return null;
}

export async function GET() {
  // Convenience GET so the UI footer can render today's budget without a POST.
  const budget = await getBudget();
  return NextResponse.json({ budget });
}
