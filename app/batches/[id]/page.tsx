import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function BatchDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const db = getDb();
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, id))
    .limit(1);
  if (!batch) notFound();

  const books = await db
    .select()
    .from(schema.books)
    .where(eq(schema.books.batchId, id));

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← All batches
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{batch.name}</h1>
        {batch.notes && (
          <p className="text-sm text-zinc-500">{batch.notes}</p>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled
          className="flex h-24 flex-col items-center justify-center gap-1 rounded border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700"
        >
          <span className="text-xl">📷</span>
          Add photo
          <span className="text-[10px]">(Phase 4)</span>
        </button>
        <button
          type="button"
          disabled
          className="flex h-24 flex-col items-center justify-center gap-1 rounded border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700"
        >
          <span className="text-xl">📚</span>
          Scan barcode
          <span className="text-[10px]">(Phase 3)</span>
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
          Books in this batch ({books.length})
        </h2>
        {books.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No books yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {books.map((book) => (
              <li key={book.id} className="px-4 py-3">
                <div className="font-medium">{book.title}</div>
                <div className="text-xs text-zinc-500">
                  {book.authors.join(" / ") || "Unknown author"}
                  {book.isbn13 && ` · ${book.isbn13}`}
                  {" · "}
                  <span className="uppercase">{book.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
