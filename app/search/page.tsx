import Link from "next/link";
import { eq, ilike, or, sql } from "drizzle-orm";
import { Search } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { stripIsbn, normalizeIsbn } from "@/lib/lookup/isbn";
import TopBar from "@/components/TopBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookCover } from "@/components/BookCover";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string }>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim();

  const results = q ? await runSearch(q) : [];

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          ← Home
        </Link>

        <header className="space-y-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Search
          </h1>
          <form
            action="/search"
            method="GET"
            role="search"
            className="flex items-center gap-2"
          >
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Title, author, or ISBN"
              autoFocus
              className="flex-1"
            />
            <Button type="submit" size="sm">
              <Search className="size-4" />
              Search
            </Button>
          </form>
        </header>

        {q ? (
          <section className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {results.length} {results.length === 1 ? "result" : "results"}{" "}
              for &ldquo;{q}&rdquo;
            </p>
            {results.length === 0 ? (
              <Card>
                <CardContent className="text-muted-foreground py-10 text-center text-sm">
                  No matches across your batches.
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-2">
                {results.map((book) => (
                  <li key={book.id}>
                    <Link
                      href={`/batches/${book.batchId}#book-${book.id}`}
                      className="block"
                    >
                      <Card className="hover:border-primary/40 overflow-hidden transition-all hover:shadow-sm">
                        <CardContent className="flex items-start gap-3 p-3">
                          <BookCover
                            coverUrl={book.coverUrl}
                            isbn13={book.isbn13}
                            isbn10={book.isbn10}
                            title={book.title}
                            size="sm"
                            className="ring-accent/20 mt-0.5 ring-1"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">{book.title}</p>
                              <Badge variant={statusBadgeVariant(book.status)}>
                                {book.status.replace("_", " ")}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground truncate text-xs">
                              {book.authors.length > 0
                                ? book.authors.join(" / ")
                                : "Unknown author"}
                              {book.isbn13 && ` · ${book.isbn13}`}
                              {book.isbn10 && !book.isbn13 && ` · ${book.isbn10}`}
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              In <span className="text-foreground">{book.batchName}</span>
                              {book.batchLocation ? ` · ${book.batchLocation}` : ""}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              Type a title, author name, or ISBN above to search across all
              your batches.
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}

async function runSearch(q: string) {
  const db = getDb();
  // Normalize the query in case it looks like an ISBN — strip hyphens, also
  // try the alternate format (10 ↔ 13). This way `978-0-...` and `0-...`
  // both find the same book.
  const stripped = stripIsbn(q);
  const normalized = normalizeIsbn(q);
  const isbnCandidates = [stripped, normalized.isbn13, normalized.isbn10]
    .filter((s): s is string => !!s && s.length >= 10);

  const wildcard = `%${q}%`;

  return db
    .select({
      id: schema.books.id,
      batchId: schema.books.batchId,
      batchName: schema.batches.name,
      batchLocation: schema.batches.location,
      title: schema.books.title,
      authors: schema.books.authors,
      isbn13: schema.books.isbn13,
      isbn10: schema.books.isbn10,
      coverUrl: schema.books.coverUrl,
      status: schema.books.status,
    })
    .from(schema.books)
    .innerJoin(
      schema.batches,
      eq(schema.books.batchId, schema.batches.id),
    )
    .where(
      or(
        ilike(schema.books.title, wildcard),
        // Substring search across the authors array. EXISTS + unnest is
        // more flexible than ANY(=) for partial matching.
        sql`EXISTS (SELECT 1 FROM unnest(${schema.books.authors}) AS a WHERE a ILIKE ${wildcard})`,
        ...(isbnCandidates.length > 0
          ? [
              sql`${schema.books.isbn13} = ANY(${isbnCandidates})`,
              sql`${schema.books.isbn10} = ANY(${isbnCandidates})`,
            ]
          : []),
      ),
    )
    .orderBy(schema.books.title)
    .limit(100);
}

function statusBadgeVariant(
  status: "pending_review" | "confirmed" | "rejected",
): "default" | "secondary" | "outline" {
  switch (status) {
    case "confirmed":
      return "default";
    case "rejected":
      return "outline";
    default:
      return "secondary";
  }
}
