import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";
import TopBar from "@/components/TopBar";
import QuickFillForm from "@/components/QuickFillForm";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function QuickFillPage({ params }: { params: Params }) {
  const userId = await requireUserId();
  const { id } = await params;

  const db = getDb();
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(and(eq(schema.batches.id, id), eq(schema.batches.ownerId, userId)))
    .limit(1);
  if (!batch) notFound();

  // Books worth a bulk re-lookup: pending review AND no ISBN yet. A book
  // that already has an ISBN got a hit at insert-time; re-running the
  // chain on it costs the same and returns the same data.
  const books = await db
    .select()
    .from(schema.books)
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.ownerId, userId),
        eq(schema.books.status, "pending_review"),
      ),
    );
  const needsIsbn = books.filter((b) => !b.isbn13 && !b.isbn10);

  // If there's nothing to fill, send the user back to the batch view —
  // the link surface on the batch page should be hiding the button in
  // that state anyway, but a direct URL visit shouldn't dead-end.
  if (needsIsbn.length === 0) {
    redirect(`/batches/${id}`);
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
        <Link
          href={`/batches/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          <ArrowLeft className="size-3" />
          Back to {batch.name}
        </Link>

        <header className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Quick-fill ISBNs
          </h1>
          <p className="text-muted-foreground text-sm">
            Type the ISBN from the back cover of each book. We&apos;ll run all
            lookups in parallel and fill in the metadata.
            <span className="text-muted-foreground/80 block pt-1 text-xs">
              {needsIsbn.length} book{needsIsbn.length === 1 ? "" : "s"} need an
              ISBN. Leave a row blank to skip it.
            </span>
          </p>
        </header>

        <QuickFillForm batchId={id} books={needsIsbn} />
      </main>
    </>
  );
}
