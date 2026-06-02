import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { ArrowLeft, MapPin } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { resolveShareToken } from "@/lib/share";
import ShareBookList from "@/components/share/ShareBookList";
import ShareGallery from "@/components/share/ShareGallery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Params = Promise<{ token: string; batchId: string }>;

export default async function ShareCartPage({
  params,
}: {
  params: Params;
}) {
  const { token, batchId } = await params;
  const ownerId = await resolveShareToken(token);
  if (!ownerId) notFound();

  const db = getDb();

  // Scope by ownerId AND batchId AND not-deleted so a token can only ever
  // surface its own owner's live carts — a foreign or deleted batch id 404s.
  const [batch] = await db
    .select({
      id: schema.batches.id,
      name: schema.batches.name,
      location: schema.batches.location,
      notes: schema.batches.notes,
    })
    .from(schema.batches)
    .where(
      and(
        eq(schema.batches.id, batchId),
        eq(schema.batches.ownerId, ownerId),
        isNull(schema.batches.deletedAt),
      ),
    )
    .limit(1);
  if (!batch) notFound();

  const [books, uploads] = await Promise.all([
    db
      .select({
        id: schema.books.id,
        title: schema.books.title,
        authors: schema.books.authors,
        isbn13: schema.books.isbn13,
        isbn10: schema.books.isbn10,
        coverUrl: schema.books.coverUrl,
        status: schema.books.status,
      })
      .from(schema.books)
      .where(
        and(
          eq(schema.books.batchId, batchId),
          eq(schema.books.ownerId, ownerId),
          // Hide rejected/trashed books; confirmed + pending reflect what's
          // actually in the box during an in-progress inventory.
          ne(schema.books.status, "rejected"),
        ),
      )
      // Shelf order first (vision position), then creation time for the rest.
      .orderBy(
        sql`${schema.books.position} NULLS LAST`,
        asc(schema.books.createdAt),
      ),
    db
      .select({
        id: schema.batchUploads.id,
        blobUrl: schema.batchUploads.blobUrl,
        boxLabel: schema.batchUploads.boxLabel,
      })
      .from(schema.batchUploads)
      .where(
        and(
          eq(schema.batchUploads.batchId, batchId),
          eq(schema.batchUploads.ownerId, ownerId),
        ),
      )
      // Group boxes together; unlabeled photos sort last.
      .orderBy(
        sql`${schema.batchUploads.boxLabel} NULLS LAST`,
        asc(schema.batchUploads.uploadedAt),
      ),
  ]);

  return (
    <main className="mx-auto w-full max-w-[80rem] space-y-6 px-4 py-8">
      <Link
        href={`/share/${token}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
      >
        <ArrowLeft className="size-3" />
        All carts
      </Link>

      <header className="space-y-2">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">
          Shared from Carnegie · read-only
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {batch.name}
        </h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {batch.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {batch.location}
            </span>
          )}
          <span>
            {books.length} {books.length === 1 ? "book" : "books"}
          </span>
        </div>
        {batch.notes && (
          <p className="text-muted-foreground max-w-prose text-sm">
            {batch.notes}
          </p>
        )}
      </header>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Books
          <span className="text-muted-foreground ml-1.5 text-sm font-normal">
            ({books.length})
          </span>
        </h2>
        <ShareBookList books={books} />
      </section>

      <ShareGallery photos={uploads} />
    </main>
  );
}
