import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { log, requestIdFrom } from "@/lib/log";
import {
  extractBooksFromImage,
  OPUS_MODEL,
  type VisionBook,
} from "@/lib/vision";
import { lookupByIsbn, normalizeIsbn } from "@/lib/lookup";
import { lookupByTitle } from "@/lib/lookup/title";
import { extractLcc, stripSpineSticker } from "@/lib/lookup/classification";
import { getBudget, incrementUsage } from "@/lib/vision-budget";

type RouteContext = {
  params: Promise<{ id: string; uploadId: string }>;
};

// Same wall-clock budget as the main vision route — Opus on a cropped
// region usually returns in 10-20s; this leaves headroom.
export const maxDuration = 60;

// Normalized 0–1 fractions of the saved image's pixel dimensions. The
// crop UI computes these from the user's drag rectangle so we don't
// have to worry about the displayed-vs-natural-resolution mismatch.
const PayloadSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id: batchId, uploadId } = await params;
  const requestId = requestIdFrom(request.headers);

  const body = await request.json().catch(() => null);
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid crop rectangle", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // A crop that's smaller than ~2% of the image in either dimension is
  // almost certainly a tap-not-drag. Reject so we don't burn an Opus
  // call on a 12-pixel-tall sliver.
  if (parsed.data.width < 0.02 || parsed.data.height < 0.02) {
    return NextResponse.json(
      { error: "Crop is too small — draw a rectangle around the book." },
      { status: 400 },
    );
  }

  const db = getDb();

  // Verify the upload belongs to this user + batch in a single query.
  // batch_uploads.owner_id is the source of truth.
  const [upload] = await db
    .select()
    .from(schema.batchUploads)
    .where(
      and(
        eq(schema.batchUploads.id, uploadId),
        eq(schema.batchUploads.batchId, batchId),
        eq(schema.batchUploads.ownerId, userId),
      ),
    )
    .limit(1);
  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  // Preflight budget check. Re-crops count against the same per-user
  // daily cap as full uploads — it's the same API call and there's no
  // honest reason to give them a separate bucket.
  const preflight = await getBudget(userId);
  if (preflight.exhausted) {
    return NextResponse.json(
      {
        error: `Daily vision budget exhausted (${preflight.used}/${preflight.limit}). Try again tomorrow.`,
        budget: preflight,
      },
      { status: 429 },
    );
  }

  // Fetch the original photo from Blob and crop it.
  let imageBuffer: Buffer;
  try {
    const res = await fetch(upload.blobUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Blob fetch ${res.status}`);
    }
    imageBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log("recrop.error", {
      request_id: requestId,
      user_id: userId,
      batch_id: batchId,
      upload_id: uploadId,
      stage: "blob_fetch",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Could not load the saved photo." },
      { status: 502 },
    );
  }

  // Normalize coords → pixel coords. Clamp to image bounds in case the
  // client sent a rectangle that's just over the edge.
  let croppedBuffer: Buffer;
  try {
    const meta = await sharp(imageBuffer).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;
    if (imgW === 0 || imgH === 0) {
      throw new Error("Image has zero dimensions");
    }
    const left = Math.max(0, Math.min(imgW - 1, Math.round(parsed.data.x * imgW)));
    const top = Math.max(0, Math.min(imgH - 1, Math.round(parsed.data.y * imgH)));
    const width = Math.max(1, Math.min(imgW - left, Math.round(parsed.data.width * imgW)));
    const height = Math.max(1, Math.min(imgH - top, Math.round(parsed.data.height * imgH)));
    croppedBuffer = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (err) {
    log("recrop.error", {
      request_id: requestId,
      user_id: userId,
      batch_id: batchId,
      upload_id: uploadId,
      stage: "crop",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Could not crop the photo." },
      { status: 500 },
    );
  }

  // Commit the budget slot before the Opus call. Same intentional
  // failure-mode as the main vision route: a failed call still spends
  // the slot so flaky paths don't look free.
  const budget = await incrementUsage(userId);

  log("recrop.start", {
    request_id: requestId,
    user_id: userId,
    batch_id: batchId,
    upload_id: uploadId,
    crop_bytes: croppedBuffer.length,
  });

  // Force Opus from the start. A user took the trouble to draw a
  // rectangle around a specific book — that's a high-value attempt,
  // worth the ~5x cost over Sonnet for the better read.
  const base64 = croppedBuffer.toString("base64");
  let extraction;
  try {
    extraction = await extractBooksFromImage(base64, "image/jpeg", OPUS_MODEL);
  } catch (err) {
    log("recrop.error", {
      request_id: requestId,
      user_id: userId,
      batch_id: batchId,
      upload_id: uploadId,
      stage: "opus",
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

  log("recrop.extract", {
    request_id: requestId,
    user_id: userId,
    batch_id: batchId,
    upload_id: uploadId,
    books: extraction.books.length,
    input_tokens: extraction.usage.input_tokens,
    output_tokens: extraction.usage.output_tokens,
  });

  if (extraction.books.length === 0) {
    return NextResponse.json({
      summary: { detected: 0, inserted: 0, budget, model: extraction.model },
      books: [],
    });
  }

  const enriched = await Promise.all(
    extraction.books.map((book) => enrichDetected(book)),
  );

  // Same insert shape as the main vision route — books land in
  // pending_review so the user can confirm/reject them just like any
  // other vision result.
  const inserted = await db
    .insert(schema.books)
    .values(
      enriched.map(({ book, lookup, visionLcc }) => {
        const visionIsbn = normalizeIsbn(book.visible_isbn ?? "");
        return {
          ownerId: userId,
          batchId,
          source: "vision" as const,
          status: "pending_review" as const,
          isbn13: visionIsbn.isbn13 ?? lookup?.isbn13 ?? null,
          isbn10: visionIsbn.isbn10 ?? lookup?.isbn10 ?? null,
          // Same rule as the main vision route: vision read the spine,
          // so vision's title/author wins. Lookup is metadata only.
          title: book.title.trim() || lookup?.title || "(no title)",
          authors: book.author
            ? [book.author]
            : (lookup?.authors ?? []),
          publisher: lookup?.publisher ?? null,
          pubDate: lookup?.pubDate ?? null,
          coverUrl: lookup?.coverUrl ?? null,
          tags: lookup?.subjects ?? [],
          lcc: lookup?.lcc ?? visionLcc ?? null,
          description: lookup?.description ?? null,
          confidence: book.confidence,
          // Recrop additions land at the end of the review queue —
          // they're new books the user added after the original
          // photo's positions were assigned, so there's no canonical
          // left-to-right slot for them.
          position: null,
          rawVision: {
            vision: book,
            lookupSource: lookup?.source ?? null,
            model: extraction.model,
            recropOf: uploadId,
            cropRect: parsed.data,
          },
        };
      }),
    )
    .returning();

  log("recrop.insert", {
    request_id: requestId,
    user_id: userId,
    batch_id: batchId,
    upload_id: uploadId,
    inserted: inserted.length,
  });

  return NextResponse.json({
    summary: {
      detected: extraction.books.length,
      inserted: inserted.length,
      budget,
      tokens: extraction.usage,
      model: extraction.model,
    },
    books: inserted,
  });
}

// Same enrichment logic as the main vision route — book in, book +
// lookup (if any) + spine-derived LCC out. Inlined rather than
// imported because the vision route doesn't export it; future
// refactor could extract to a shared lib once the third caller
// shows up.
async function enrichDetected(book: VisionBook) {
  const cleanedBook: VisionBook = {
    ...book,
    title: stripSpineSticker(book.title) || book.title,
    author: book.author ? stripSpineSticker(book.author) || book.author : null,
  };
  const visionLcc = extractLcc(book.spine_classification);

  if (cleanedBook.visible_isbn) {
    const outcome = await lookupByIsbn(cleanedBook.visible_isbn);
    if (outcome.result) {
      return { book: cleanedBook, lookup: outcome.result, visionLcc };
    }
  }
  const fromTitle = await lookupByTitle(cleanedBook.title, cleanedBook.author);
  return { book: cleanedBook, lookup: fromTitle, visionLcc };
}
