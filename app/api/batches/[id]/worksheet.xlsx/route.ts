import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { buildWorksheet, worksheetFilename } from "@/lib/worksheet";

type RouteContext = { params: Promise<{ id: string }> };

// One batch as a working spreadsheet. Pure read — like the CSV export, and
// unlike the CSV export used to be, downloading this changes nothing.
//
// Includes pending books as well as confirmed, which is the one place it
// deliberately differs from the LibraryThing CSV. That CSV feeds an importer
// and must only carry rows you've vouched for; this sheet is for deciding
// what to do with the collection, and a book you haven't reviewed yet is
// still a book on the shelf. Rejected (trashed) rows stay out.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const db = getDb();

  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(
      and(
        eq(schema.batches.id, id),
        eq(schema.batches.ownerId, userId),
        isNull(schema.batches.deletedAt),
      ),
    )
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      book: schema.books,
      boxLabel: schema.batchUploads.boxLabel,
    })
    .from(schema.books)
    // Left join: a book only has an upload when it came from a photo taken
    // after Carnegie started recording the link. Barcode scans, manual
    // entries and everything catalogued before then have no box.
    .leftJoin(
      schema.batchUploads,
      eq(schema.books.uploadId, schema.batchUploads.id),
    )
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.ownerId, userId),
        ne(schema.books.status, "rejected"),
      ),
    )
    .orderBy(sql`${schema.books.position} NULLS LAST`, asc(schema.books.createdAt));

  const buffer = await buildWorksheet(
    rows.map((r) => ({
      book: r.book,
      batchName: batch.name,
      batchLocation: batch.location,
      boxLabel: r.boxLabel,
    })),
    batch.name,
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${worksheetFilename(batch.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
