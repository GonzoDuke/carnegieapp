import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import DuplicatesList, {
  type DuplicateBook,
  type DuplicateGroup,
} from "@/components/DuplicatesList";

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

  const [userRows, rowsRaw] = await Promise.all([
    db
      .select({ ignoreDuplicates: schema.users.ignoreDuplicates })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    // Pull every book whose ISBN matches another of THIS user's books (by
    // canonical ISBN-13 falling back to ISBN-10). Cross-user dupes are
    // ignored — each user's library is its own duplication scope. Grouping
    // happens in JS afterward.
    db.select({
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
        sql`${schema.batches.deletedAt} IS NULL`,
        sql`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10}) IN (
          SELECT COALESCE(b.isbn_13, b.isbn_10) AS canonical
          FROM books b
          JOIN batches ba ON ba.id = b.batch_id
          WHERE b.owner_id = ${userId}
            AND ba.deleted_at IS NULL
            AND (b.isbn_13 IS NOT NULL OR b.isbn_10 IS NOT NULL)
          GROUP BY COALESCE(b.isbn_13, b.isbn_10)
          HAVING COUNT(*) > 1
        )`,
      ),
    )
    .orderBy(
      sql`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10})`,
      schema.books.createdAt,
    ),
  ]);

  const ignoreDuplicates = userRows[0]?.ignoreDuplicates ?? false;
  const rows = rowsRaw as DuplicateRow[];

  // Group rows by canonical ISBN, formatting the added-date here so the
  // client list never touches toLocaleDateString (hydration-safe) and the
  // payload stays plain-serializable.
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const groupsMap = new Map<string, DuplicateGroup>();
  for (const row of rows) {
    const book: DuplicateBook = {
      id: row.id,
      batchId: row.batchId,
      batchName: row.batchName,
      title: row.title,
      authors: row.authors,
      isbn13: row.isbn13,
      isbn10: row.isbn10,
      coverUrl: row.coverUrl,
      status: row.status,
      addedLabel: dateFmt.format(row.createdAt),
    };
    const group = groupsMap.get(row.canonicalIsbn);
    if (group) {
      group.books.push(book);
    } else {
      groupsMap.set(row.canonicalIsbn, {
        isbn: row.canonicalIsbn,
        books: [book],
      });
    }
  }
  const groups = Array.from(groupsMap.values());

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-[96rem] space-y-6 px-4 py-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          ← Home
        </Link>

        <DuplicatesList groups={groups} initialIgnored={ignoreDuplicates} />
      </main>
    </>
  );
}

