import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { batchSlug, buildLibraryThingCsv } from "@/lib/csv";
import { buildZip, type ZipEntry } from "@/lib/zip";
import { log, requestIdFrom } from "@/lib/log";

type RouteContext = { params: Promise<{ id: string }> };

// "Download whole batch" — bundles the LibraryThing CSV (the same confirmed
// books export.csv produces) together with the original shelf photos into a
// single .zip. Read-only and on-demand: unlike export.csv it does NOT stamp
// exportedAt, because this is an archival download, not "sent to LibraryThing".
export async function GET(request: NextRequest, { params }: RouteContext) {
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
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const [books, uploads] = await Promise.all([
    db
      .select()
      .from(schema.books)
      .where(
        and(
          eq(schema.books.batchId, id),
          eq(schema.books.ownerId, userId),
          eq(schema.books.status, "confirmed"),
        ),
      ),
    db
      .select()
      .from(schema.batchUploads)
      .where(
        and(
          eq(schema.batchUploads.batchId, id),
          eq(schema.batchUploads.ownerId, userId),
        ),
      )
      .orderBy(asc(schema.batchUploads.uploadedAt)),
  ]);

  const slug = batchSlug(batch.name);
  const entries: ZipEntry[] = [
    {
      name: `${slug}.csv`,
      data: new TextEncoder().encode(buildLibraryThingCsv(books, batch)),
    },
  ];

  // Fetch every photo from Blob in parallel. A failed fetch shouldn't sink
  // the whole download — collect what we can and note any that are missing.
  const pad = String(uploads.length).length;
  const fetched = await Promise.allSettled(
    uploads.map(async (upload, i) => {
      const res = await fetch(upload.blobUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = extFromPath(upload.blobPath);
      const index = String(i + 1).padStart(pad, "0");
      return {
        name: `photos/photo-${index}.${ext}`,
        data: new Uint8Array(await res.arrayBuffer()),
      } satisfies ZipEntry;
    }),
  );

  const missing: number[] = [];
  fetched.forEach((result, i) => {
    if (result.status === "fulfilled") {
      entries.push(result.value);
    } else {
      missing.push(i + 1);
    }
  });
  if (missing.length > 0) {
    entries.push({
      name: "photos/_unavailable.txt",
      data: new TextEncoder().encode(
        `${missing.length} of ${uploads.length} photo(s) could not be retrieved ` +
          `from storage at download time (photo numbers: ${missing.join(", ")}).\n`,
      ),
    });
  }

  // Re-wrap as a plain ArrayBuffer-backed view: a Node Buffer's typing
  // (Uint8Array<ArrayBufferLike>) doesn't satisfy the Web BodyInit type
  // NextResponse expects.
  const body = new Uint8Array(buildZip(entries));

  log("batch.archive", {
    request_id: requestId,
    user_id: userId,
    batch_id: id,
    books: books.length,
    photos_ok: uploads.length - missing.length,
    photos_missing: missing.length,
    bytes: body.length,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}-${stamp}.zip"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  });
}

// Pull a lowercase, alnum-only extension off the stored blob path
// (e.g. "vision/<id>/abc.jpg" -> "jpg"). Falls back to jpg — every upload
// path the vision route writes carries one of jpg/png/webp.
function extFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || "jpg";
}
