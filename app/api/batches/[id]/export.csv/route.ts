import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { batchSlug, buildLibraryThingCsv } from "@/lib/csv";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const db = getDb();

  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(and(eq(schema.batches.id, id), eq(schema.batches.ownerId, userId)))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const books = await db
    .select()
    .from(schema.books)
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.ownerId, userId),
        eq(schema.books.status, "confirmed"),
      ),
    );

  const csv = buildLibraryThingCsv(books, batch);
  const filename = csvFilename(batch.name);

  // Deliberately a pure read: downloading the CSV changes nothing. This
  // route used to stamp batches.exported_at, which meant pulling a working
  // copy of a list silently filed the batch into the Archive and off the
  // home page — with no way back. Marking a batch finished is now an
  // explicit action (POST _action=complete on the batch route), so you can
  // export the same batch as many times as the work needs.
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvFilename(batchName: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${batchSlug(batchName)}-${stamp}.csv`;
}
