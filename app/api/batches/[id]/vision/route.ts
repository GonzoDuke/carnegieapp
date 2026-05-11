import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { log, requestIdFrom } from "@/lib/log";
import {
  extractBooksFromImage,
  OPUS_MODEL,
  type VisionBook,
  type VisionExtraction,
} from "@/lib/vision";
import { lookupByIsbn, normalizeIsbn } from "@/lib/lookup";
import { lookupByTitle } from "@/lib/lookup/title";
import { extractLcc, stripSpineSticker } from "@/lib/lookup/classification";
import { getBudget, incrementUsage } from "@/lib/vision-budget";

type RouteContext = { params: Promise<{ id: string }> };

// Larger body for image uploads — default Vercel function limit (4.5MB) is
// already enough for our compressed JPEGs, but extending the timeout helps
// because vision calls can take 15–30s.
export const maxDuration = 60;

// Below this confidence we re-run the same image on Opus and prefer that
// result. Tuned for the trade-off: 0.7 catches the genuinely-ambiguous
// reads without burning Opus budget on every photo (Sonnet on a clean
// shelf typically lands 0.85+ across the board).
const LOW_CONFIDENCE = 0.7;

// Anthropic rejects images whose **base64-encoded** payload exceeds
// 5 MiB. Base64 expansion is 4/3, so raw bytes can be at most ~3.75 MiB
// before the encoded size trips the cap. PhotoCapture already compresses
// on the client, so the production path stays well under this — but a
// curl bypass or a future non-PhotoCapture caller would otherwise
// surface a generic 502 from the SDK. Cap the request here and return
// an actionable 413 instead.
const MAX_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4); // 3,932,160

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const requestId = requestIdFrom(request.headers);

  const db = getDb();
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(and(eq(schema.batches.id, id), eq(schema.batches.ownerId, userId)))
    .limit(1);
  if (!batch) {
    log("vision.error", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      reason: "batch_not_found",
    });
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  // Pre-flight budget check (cheap). The actual decrement happens after we
  // commit to spending the call.
  const preflight = await getBudget(userId);
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

  if (bytes.length > MAX_IMAGE_BYTES) {
    log("vision.error", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      reason: "image_too_large",
      bytes: bytes.length,
      limit: MAX_IMAGE_BYTES,
    });
    return NextResponse.json(
      {
        error: `Image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB raw; the limit after base64 encoding is 5 MB (≈ ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1)} MB raw). Take a smaller photo or use the in-app capture (which compresses automatically).`,
      },
      { status: 413 },
    );
  }

  const base64 = bytes.toString("base64");

  log("vision.start", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    media_type: mediaType,
    bytes: bytes.length,
  });

  // Reserve the budget slot before calling Claude. If the call fails, this
  // slot is already spent — that's intentional: we don't want a flaky vision
  // call to look free.
  let budget = await incrementUsage(userId);

  let extraction: VisionExtraction;
  try {
    extraction = await extractBooksFromImage(base64, mediaType);
  } catch (err) {
    log("vision.error", {
      request_id: requestId,
      user_id: userId,
      batch_id: id,
      stage: "sonnet",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        budget,
      },
      { status: 502 },
    );
  }

  // Confidence-gated escalation: if Sonnet flagged any spine as uncertain
  // and we still have budget headroom, re-run the same image on Opus and
  // prefer that result. We never escalate when Sonnet returned zero books
  // (different problem — bad photo, not bad reading).
  //
  // A two-pass detect→crop→per-spine-read variant lives in lib/vision.ts
  // (detectSpineBoxes / cropImage / extractOneSpineFromImage) and was
  // tested as an alternative escalation path. The eval showed it net-
  // negative outside a narrow set of cross-attribution cases — detection
  // over-detects, the per-spine reads then lose visual context, and easy
  // photos that single-pass nails fall apart. Helpers are kept for
  // future experimentation; the route uses Opus-full escalation.
  const lowestConfidence = extraction.books.length
    ? Math.min(...extraction.books.map((b) => b.confidence))
    : 1;
  let escalated = false;
  if (
    extraction.books.length > 0 &&
    lowestConfidence < LOW_CONFIDENCE &&
    !budget.exhausted
  ) {
    budget = await incrementUsage(userId);
    try {
      const opus = await extractBooksFromImage(base64, mediaType, OPUS_MODEL);
      if (opus.books.length > 0) {
        extraction = opus;
        escalated = true;
      }
    } catch (err) {
      // Opus failed (rate-limit, timeout) — fall back to Sonnet's read. The
      // budget tick is already spent; that's acceptable cost-of-trying.
      log("vision.error", {
        request_id: requestId,
        user_id: userId,
        batch_id: id,
        stage: "opus_escalation",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log("vision.extract", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    model: extraction.model,
    books: extraction.books.length,
    lowest_confidence: lowestConfidence,
    escalated,
    input_tokens: extraction.usage.input_tokens,
    output_tokens: extraction.usage.output_tokens,
  });

  if (extraction.books.length === 0) {
    return NextResponse.json({
      summary: { detected: 0, inserted: 0, budget, escalated },
      books: [],
      raw: extraction.raw,
    });
  }

  // For each detected book, try to upgrade to canonical metadata.
  const enriched = await Promise.all(
    extraction.books.map((book) => enrichDetected(book)),
  );

  // Aggregate the lookup outcomes into one event rather than per-book
  // noise. Sources are interesting in aggregate ("ISBNdb won 5 of 7"),
  // less so individually.
  const lookupSources: Record<string, number> = {};
  let lookupHits = 0;
  for (const e of enriched) {
    if (e.lookup) {
      lookupHits++;
      const src = e.lookup.source ?? "unknown";
      lookupSources[src] = (lookupSources[src] ?? 0) + 1;
    }
  }
  log("vision.lookup", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    detected: enriched.length,
    lookup_hits: lookupHits,
    lookup_misses: enriched.length - lookupHits,
    sources: lookupSources,
  });

  const inserted = await db
    .insert(schema.books)
    .values(
      enriched.map(({ book, lookup, visionLcc }) => {
        // Vision-detected ISBN is authoritative — the chain may return a
        // different-edition record for the same title, but the user
        // photographed THIS specific copy and the barcode digits are
        // unambiguous. Only fall back to the chain's ISBN when vision
        // didn't pick one up.
        const visionIsbn = normalizeIsbn(book.visible_isbn ?? "");
        return ({
        ownerId: userId,
        batchId: id,
        source: "vision" as const,
        // Vision results always go through review — even high-confidence ones,
        // because misreads on spines are common and a wrong row in the export
        // is worse than 5 seconds of confirmation.
        status: "pending_review" as const,
        isbn13: visionIsbn.isbn13 ?? lookup?.isbn13 ?? null,
        isbn10: visionIsbn.isbn10 ?? lookup?.isbn10 ?? null,
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
        // API-returned LCC always wins over a sticker-derived one — the
        // provider has the canonical edition data. Sticker is the fallback.
        lcc: lookup?.lcc ?? visionLcc ?? null,
        description: lookup?.description ?? null,
        confidence: book.confidence,
        rawVision: {
          vision: book,
          lookupSource: lookup?.source ?? null,
          model: extraction.model,
        },
        });
      }),
    )
    .returning();

  log("vision.insert", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    inserted: inserted.length,
  });

  return NextResponse.json({
    summary: {
      detected: extraction.books.length,
      inserted: inserted.length,
      budget,
      tokens: extraction.usage,
      model: extraction.model,
      escalated,
    },
    books: inserted,
  });
}

async function enrichDetected(book: VisionBook) {
  // Belt-and-suspenders: the prompt tells the model to keep library shelf
  // stickers out of title/author and put them in spine_classification, but
  // strip any residue that slipped through before we hand text to the lookup
  // chain — a polluted title is a guaranteed lookup miss.
  const cleanedBook: VisionBook = {
    ...book,
    title: stripSpineSticker(book.title) || book.title,
    author: book.author ? stripSpineSticker(book.author) || book.author : null,
  };
  const visionLcc = extractLcc(book.spine_classification);

  // If the model spotted an ISBN, use the existing chain — much higher quality.
  if (cleanedBook.visible_isbn) {
    const outcome = await lookupByIsbn(cleanedBook.visible_isbn);
    if (outcome.result) {
      return { book: cleanedBook, lookup: outcome.result, visionLcc };
    }
  }
  // Otherwise try a title+author search against Google Books.
  const fromTitle = await lookupByTitle(cleanedBook.title, cleanedBook.author);
  return { book: cleanedBook, lookup: fromTitle, visionLcc };
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
  const userId = await requireUserId();
  const budget = await getBudget(userId);
  return NextResponse.json({ budget });
}
