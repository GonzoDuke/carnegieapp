import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, Check, Library } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import { BookCover } from "@/components/BookCover";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Archive — Carnegie",
};

export default async function ArchivePage() {
  const userId = await requireUserId();
  const db = getDb();

  // Same correlated-subquery shape as the home page; same hand-qualified
  // table prefixes so the count actually correlates (Drizzle's bare
  // ${schema.X.col} interpolation produces unqualified column names that
  // collide with the inner FROM in correlated subqueries).
  const batches = await db
    .select({
      id: schema.batches.id,
      name: schema.batches.name,
      location: schema.batches.location,
      createdAt: schema.batches.createdAt,
      exportedAt: schema.batches.exportedAt,
      bookCount: sql<number>`(SELECT COUNT(*)::int FROM books WHERE books.batch_id = batches.id)`,
      sampleBooks: sql<
        Array<{
          coverUrl: string | null;
          isbn13: string | null;
          isbn10: string | null;
          title: string;
        }>
      >`(
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'coverUrl', cover_url,
              'isbn13', isbn_13,
              'isbn10', isbn_10,
              'title', title
            )
          ),
          '[]'::json
        )
        FROM (
          SELECT cover_url, isbn_13, isbn_10, title
          FROM books
          WHERE books.batch_id = batches.id
            AND books.status = 'confirmed'
          ORDER BY books.created_at DESC
          LIMIT 6
        ) sub
      )`,
    })
    .from(schema.batches)
    .where(
      and(
        eq(schema.batches.ownerId, userId),
        sql`${schema.batches.exportedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(schema.batches.exportedAt));

  const totalBooks = batches.reduce((sum, b) => sum + b.bookCount, 0);

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Home
        </Link>

        <header className="space-y-2">
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.2em]">
            <Library className="size-3" />
            Archive
          </p>
          <h1 className="font-heading text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            <span className="tabular-nums">{batches.length}</span>{" "}
            <span className="text-muted-foreground">
              {batches.length === 1 ? "batch" : "batches"} sent to LibraryThing.
            </span>
          </h1>
          {totalBooks > 0 && (
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-semibold tabular-nums">
                {totalBooks.toLocaleString()}
              </span>{" "}
              {totalBooks === 1 ? "book" : "books"} cataloged across this archive.
            </p>
          )}
        </header>

        {batches.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-base">
              <Check className="text-primary size-6" />
              <span>
                Nothing here yet. Batches land here once you export them to
                LibraryThing.
              </span>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/batches/${b.id}`} className="group block">
                  <Card className="hover:border-primary/40 hover:shadow-md overflow-hidden transition-all">
                    <CardContent className="space-y-4 p-5 sm:p-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <div className="min-w-0">
                          <h2 className="font-heading group-hover:text-primary text-xl font-semibold tracking-tight transition-colors sm:text-2xl">
                            {b.name}
                          </h2>
                          {b.location && (
                            <p className="text-muted-foreground text-sm">
                              {b.location}
                            </p>
                          )}
                        </div>
                        <p className="text-muted-foreground inline-flex items-center gap-2 text-sm">
                          <Check className="text-primary size-4" />
                          Sent{" "}
                          {b.exportedAt!.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          <span className="text-muted-foreground">
                            · {b.bookCount}{" "}
                            {b.bookCount === 1 ? "book" : "books"}
                          </span>
                        </p>
                      </div>

                      {b.sampleBooks.length > 0 && (
                        <div className="flex gap-2 overflow-hidden">
                          {b.sampleBooks.map((book, i) => (
                            <BookCover
                              key={i}
                              coverUrl={book.coverUrl}
                              isbn13={book.isbn13}
                              isbn10={book.isbn10}
                              title={book.title}
                              size="sm"
                              className="shrink-0"
                            />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
