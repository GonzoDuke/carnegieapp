import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import { BookOpen, Images, Package } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { resolveShareToken } from "@/lib/share";
import { Card, CardContent } from "@/components/ui/card";
import BrandMark from "@/components/BrandMark";

export const dynamic = "force-dynamic";

// The share link is an unguessable bearer token. Keep it out of search
// engines so it can't be discovered by crawling.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Params = Promise<{ token: string }>;

export default async function ShareCollectionPage({
  params,
}: {
  params: Params;
}) {
  const { token } = await params;
  const ownerId = await resolveShareToken(token);
  if (!ownerId) notFound();

  const db = getDb();

  const [owner] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, ownerId))
    .limit(1);

  // Non-deleted carts, newest first. Counts come from two cheap companion
  // queries grouped by batch and stitched in JS — avoids N+1 per card.
  const [batches, bookCounts, uploads] = await Promise.all([
    db
      .select({
        id: schema.batches.id,
        name: schema.batches.name,
        location: schema.batches.location,
        createdAt: schema.batches.createdAt,
      })
      .from(schema.batches)
      .where(
        and(
          eq(schema.batches.ownerId, ownerId),
          isNull(schema.batches.deletedAt),
        ),
      )
      .orderBy(desc(schema.batches.createdAt)),
    db
      .select({ batchId: schema.books.batchId, n: count() })
      .from(schema.books)
      .where(
        and(
          eq(schema.books.ownerId, ownerId),
          ne(schema.books.status, "rejected"),
        ),
      )
      .groupBy(schema.books.batchId),
    db
      .select({
        batchId: schema.batchUploads.batchId,
        blobUrl: schema.batchUploads.blobUrl,
        uploadedAt: schema.batchUploads.uploadedAt,
      })
      .from(schema.batchUploads)
      .where(eq(schema.batchUploads.ownerId, ownerId))
      .orderBy(schema.batchUploads.uploadedAt),
  ]);

  const bookCountByBatch = new Map(bookCounts.map((r) => [r.batchId, r.n]));
  // First photo per batch becomes the card thumbnail — the actual box, which
  // is more useful here than cover art. Also tally photos per batch.
  const photoCountByBatch = new Map<string, number>();
  const thumbByBatch = new Map<string, string>();
  for (const u of uploads) {
    photoCountByBatch.set(
      u.batchId,
      (photoCountByBatch.get(u.batchId) ?? 0) + 1,
    );
    if (!thumbByBatch.has(u.batchId)) thumbByBatch.set(u.batchId, u.blobUrl);
  }

  return (
    <main className="mx-auto w-full max-w-[80rem] space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className="ring-primary/40 flex size-7 items-center justify-center overflow-hidden rounded ring-1">
            <BrandMark className="text-primary size-4" />
          </span>
          Shared from Carnegie · read-only
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {owner?.name ? `${owner.name}'s carts` : "Shared carts"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {batches.length} {batches.length === 1 ? "cart" : "carts"}. Tap a cart
          to see its book list and box photos.
        </p>
      </header>

      {batches.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No carts have been shared yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {batches.map((b) => {
            const thumb = thumbByBatch.get(b.id);
            const bookN = bookCountByBatch.get(b.id) ?? 0;
            const photoN = photoCountByBatch.get(b.id) ?? 0;
            return (
              <li key={b.id}>
                <Link
                  href={`/share/${token}/cart/${b.id}`}
                  className="block h-full"
                >
                  <Card className="hover:border-primary/40 h-full overflow-hidden transition-all hover:shadow-sm">
                    <div className="bg-muted relative aspect-video overflow-hidden border-b">
                      {thumb ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={thumb}
                          alt={`${b.name} box photo`}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="text-muted-foreground/40 flex size-full items-center justify-center">
                          <Package className="size-8" />
                        </div>
                      )}
                    </div>
                    <CardContent className="space-y-1 p-3">
                      <p className="font-heading truncate font-semibold">
                        {b.name}
                      </p>
                      {b.location && (
                        <p className="text-muted-foreground truncate text-xs">
                          {b.location}
                        </p>
                      )}
                      <div className="text-muted-foreground flex items-center gap-3 pt-0.5 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <BookOpen className="size-3.5" />
                          {bookN} {bookN === 1 ? "book" : "books"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Images className="size-3.5" />
                          {photoN}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
