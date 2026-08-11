import { NextResponse } from "next/server";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { buildWorksheet, worksheetFilename } from "@/lib/worksheet";

// Every batch as one working spreadsheet — the whole collection in a single
// sheet you can filter by batch, box or call number.
//
// Differs from the master CSV in two ways, both deliberate: it includes
// pending books (a book you haven't reviewed is still on the shelf), and it
// includes batches you haven't marked complete (weeding doesn't wait for
// cataloguing to be signed off). Trashed rows stay out.
export async function GET() {
  const userId = await requireUserId();
  const db = getDb();

  const rows = await db
    .select({
      book: schema.books,
      batchName: schema.batches.name,
      batchLocation: schema.batches.location,
      boxLabel: schema.batchUploads.boxLabel,
    })
    .from(schema.books)
    .innerJoin(schema.batches, eq(schema.books.batchId, schema.batches.id))
    .leftJoin(
      schema.batchUploads,
      eq(schema.books.uploadId, schema.batchUploads.id),
    )
    .where(
      and(
        eq(schema.books.ownerId, userId),
        ne(schema.books.status, "rejected"),
        isNull(schema.batches.deletedAt),
      ),
    )
    .orderBy(
      asc(schema.batches.createdAt),
      sql`${schema.books.position} NULLS LAST`,
      asc(schema.books.createdAt),
    );

  const buffer = await buildWorksheet(
    rows.map((r) => ({
      book: r.book,
      batchName: r.batchName,
      batchLocation: r.batchLocation,
      boxLabel: r.boxLabel,
    })),
    "All batches",
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${worksheetFilename("carnegie-collection")}"`,
      "Cache-Control": "no-store",
    },
  });
}
