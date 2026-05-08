import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { lookupByIsbn } from "@/lib/lookup";

type RouteContext = { params: Promise<{ id: string }> };

const ScanPayloadSchema = z.object({
  code: z.string().trim().min(1).max(100),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ScanPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid scan payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const code = parsed.data.code;
  const outcome = await lookupByIsbn(code);

  const isbn13 = outcome.isbn.isbn13;
  const isbn10 = outcome.isbn.isbn10;
  const matched = outcome.result;

  const db = getDb();
  const [book] = await db
    .insert(schema.books)
    .values({
      batchId: id,
      source: "barcode",
      // Barcode + lookup hit is high-confidence; default to confirmed (still editable).
      // Lookup miss leaves the row in the review queue.
      status: matched ? "confirmed" : "pending_review",
      isbn13: matched?.isbn13 ?? isbn13,
      isbn10: matched?.isbn10 ?? isbn10,
      title: matched?.title || "Scanned book (lookup failed)",
      authors: matched?.authors ?? [],
      publisher: matched?.publisher ?? null,
      pubDate: matched?.pubDate ?? null,
      coverUrl: matched?.coverUrl ?? null,
      tags: matched?.subjects ?? [],
      lcc: matched?.lcc ?? null,
      description: matched?.description ?? null,
      comments: matched ? null : `Scanned barcode: ${code}`,
    })
    .returning();

  return NextResponse.json(
    {
      book,
      lookup: {
        matched: !!matched,
        source: matched?.source ?? null,
        attempts: outcome.attempts.map((a) => ({
          source: a.source,
          ok: !!a.result,
          error: a.error ?? null,
        })),
      },
    },
    { status: 201 },
  );
}
