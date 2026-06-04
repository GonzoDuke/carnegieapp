import { NextResponse } from "next/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { buildMasterCsv } from "@/lib/csv";

// Master list: every confirmed book across all of the current account's
// exported, non-deleted carts, merged into one CSV. Same columns as the
// per-cart LibraryThing export, plus a leading "Cart" column. Owner-scoped
// and behind auth (under /api/, so the proxy gates it) — this is the
// operator's full catalog, not the public share surface.
export async function GET() {
  const userId = await requireUserId();
  const db = getDb();

  const rows = await db
    .select({
      book: schema.books,
      batchName: schema.batches.name,
      batchLocation: schema.batches.location,
    })
    .from(schema.books)
    .innerJoin(schema.batches, eq(schema.books.batchId, schema.batches.id))
    .where(
      and(
        eq(schema.books.ownerId, userId),
        eq(schema.books.status, "confirmed"),
        isNull(schema.batches.deletedAt),
        // Only carts that produced an export sheet — the "docs we've generated".
        sql`${schema.batches.exportedAt} IS NOT NULL`,
      ),
    )
    // Carts in creation order, books in shelf order within each cart.
    .orderBy(
      asc(schema.batches.createdAt),
      sql`${schema.books.position} NULLS LAST`,
      asc(schema.books.createdAt),
    );

  const items = rows.map((r) => ({
    book: r.book,
    batch: { name: r.batchName, location: r.batchLocation },
  }));
  const csv = buildMasterCsv(items);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="carnegie-master-list-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
