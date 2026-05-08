import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookCover } from "@/components/BookCover";

export const dynamic = "force-dynamic";

type DuplicateRow = {
  id: string;
  batchId: string;
  batchName: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  status: "pending_review" | "confirmed" | "rejected";
  createdAt: Date;
  canonicalIsbn: string;
};

export default async function DuplicatesPage() {
  const userId = await requireUserId();
  const db = getDb();

  // Pull every book whose ISBN matches another of THIS user's books (by
  // canonical ISBN-13 falling back to ISBN-10). Cross-user dupes are
  // ignored — each user's library is its own duplication scope. Grouping
  // happens in JS afterward.
  const rows = (await db
    .select({
      id: schema.books.id,
      batchId: schema.books.batchId,
      batchName: schema.batches.name,
      title: schema.books.title,
      authors: schema.books.authors,
      isbn13: schema.books.isbn13,
      isbn10: schema.books.isbn10,
      coverUrl: schema.books.coverUrl,
      status: schema.books.status,
      createdAt: schema.books.createdAt,
      canonicalIsbn: sql<string>`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10})`,
    })
    .from(schema.books)
    .innerJoin(schema.batches, eq(schema.books.batchId, schema.batches.id))
    .where(
      and(
        eq(schema.books.ownerId, userId),
        sql`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10}) IN (
          SELECT COALESCE(isbn_13, isbn_10) AS canonical
          FROM books
          WHERE owner_id = ${userId}
            AND (isbn_13 IS NOT NULL OR isbn_10 IS NOT NULL)
          GROUP BY COALESCE(isbn_13, isbn_10)
          HAVING COUNT(*) > 1
        )`,
      ),
    )
    .orderBy(
      sql`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10})`,
      schema.books.createdAt,
    )) as DuplicateRow[];

  // Group rows by canonical ISBN
  const groupsMap = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    const key = row.canonicalIsbn;
    const list = groupsMap.get(key) ?? [];
    list.push(row);
    groupsMap.set(key, list);
  }
  const groups = Array.from(groupsMap.entries());

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          ← Home
        </Link>

        <header className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Possible duplicates
          </h1>
          <p className="text-muted-foreground text-sm">
            Books that share an ISBN across batches. Vision often captures the
            same book twice when shelf photos overlap. Delete the copy you
            don&apos;t want to keep.
          </p>
        </header>

        {groups.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No duplicates found.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-4">
            {groups.map(([isbn, books]) => (
              <li key={isbn}>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-muted-foreground mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider">
                      <span>ISBN</span>
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono normal-case tracking-normal">
                        {isbn}
                      </code>
                      <span>
                        · {books.length}{" "}
                        {books.length === 2 ? "copies" : "copies"}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {books.map((book) => (
                        <li
                          key={book.id}
                          className="flex items-start gap-3 rounded-md border p-3"
                        >
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
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              In{" "}
                              <Link
                                href={`/batches/${book.batchId}#book-${book.id}`}
                                className="text-foreground hover:underline"
                              >
                                {book.batchName}
                              </Link>{" "}
                              · added{" "}
                              {book.createdAt.toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                          <form
                            method="POST"
                            action={`/api/batches/${book.batchId}/books/${book.id}`}
                          >
                            <input type="hidden" name="_action" value="delete" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon-sm"
                              title="Delete this copy"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
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

