import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { buildLibraryThingCsv } from "@/lib/csv";

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

  // Stamp the batch as exported. Only when there's actually content to export
  // — empty CSVs shouldn't count as a real export.
  if (books.length > 0) {
    await db
      .update(schema.batches)
      .set({ exportedAt: new Date() })
      .where(and(eq(schema.batches.id, id), eq(schema.batches.ownerId, userId)));

    // Clear the stored shelf photos. Once the batch has shipped to
    // LibraryThing the photo's only further use would be re-cataloging,
    // which means a new batch anyway. Keeping them indefinitely just
    // burns Blob storage. Per-photo del() + delete the upload rows.
    const uploads = await db
      .select({ id: schema.batchUploads.id, blobUrl: schema.batchUploads.blobUrl })
      .from(schema.batchUploads)
      .where(
        and(
          eq(schema.batchUploads.batchId, id),
          eq(schema.batchUploads.ownerId, userId),
        ),
      );
    if (uploads.length > 0) {
      const urls = uploads.map((u) => u.blobUrl);
      // del() accepts a URL or array of URLs. Best-effort: if Blob
      // rejects (e.g. a URL that's already been removed), swallow so
      // the export still succeeds.
      try {
        await del(urls);
      } catch {
        /* swallow — the row cleanup below still proceeds */
      }
      await db
        .delete(schema.batchUploads)
        .where(
          and(
            eq(schema.batchUploads.batchId, id),
            eq(schema.batchUploads.ownerId, userId),
          ),
        );
    }
  }

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
  const safe = batchName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe || "batch"}-${stamp}.csv`;
}
