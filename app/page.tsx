import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = getDb();
  const batches = await db
    .select()
    .from(schema.batches)
    .orderBy(desc(schema.batches.createdAt));

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Zippy Planet</h1>
          <p className="text-sm text-zinc-500">
            Photograph shelves, scan barcodes, export to LibraryThing.
          </p>
        </div>
        <form method="POST" action="/api/logout">
          <button
            type="submit"
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Log out
          </button>
        </form>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
          New batch
        </h2>
        <form
          method="POST"
          action="/api/batches"
          className="flex gap-2"
        >
          <input
            type="text"
            name="name"
            required
            placeholder="e.g. Garage box 3"
            maxLength={200}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Create
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
          Batches
        </h2>
        {batches.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No batches yet. Create one above to start cataloging.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/batches/${b.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="font-medium">{b.name}</span>
                  <span className="text-xs text-zinc-500">
                    {b.createdAt.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
