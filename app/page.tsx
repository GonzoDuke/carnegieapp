import Link from "next/link";
import { asc, count, desc, eq, gt, sql } from "drizzle-orm";
import { BookCheck, BookMarked, Check, Clock, Library, Sparkles } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { getBudget } from "@/lib/vision-budget";
import { Card, CardContent } from "@/components/ui/card";
import CreateBatchDialog from "@/components/CreateBatchDialog";
import TopBar from "@/components/TopBar";
import { BookCover } from "@/components/BookCover";
import QuickAddBar from "@/components/QuickAddBar";
import PendingReviewPanel, {
  type PendingBook,
} from "@/components/PendingReviewPanel";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = getDb();

  // One query for the batch list (with per-batch counts and sample cover
  // ISBNs); four parallel count queries for the dashboard stats; one
  // cross-batch query for pending review items. Neon HTTP pools these.
  const [
    batches,
    [{ n: totalBooks }],
    [{ n: confirmedBooks }],
    [{ n: weeklyBooks }],
    budget,
    pendingBooksRaw,
  ] = await Promise.all([
      db
        .select({
          id: schema.batches.id,
          name: schema.batches.name,
          location: schema.batches.location,
          createdAt: schema.batches.createdAt,
          exportedAt: schema.batches.exportedAt,
          bookCount: sql<number>`(SELECT COUNT(*)::int FROM ${schema.books} WHERE ${schema.books.batchId} = ${schema.batches.id})`,
          confirmedCount: sql<number>`(SELECT COUNT(*)::int FROM ${schema.books} WHERE ${schema.books.batchId} = ${schema.batches.id} AND ${schema.books.status} = 'confirmed')`,
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
              FROM ${schema.books}
              WHERE ${schema.books.batchId} = ${schema.batches.id}
                AND ${schema.books.status} = 'confirmed'
              ORDER BY created_at DESC
              LIMIT 3
            ) sub
          )`,
        })
        .from(schema.batches)
        .orderBy(desc(schema.batches.createdAt)),
      db.select({ n: count() }).from(schema.books),
      db
        .select({ n: count() })
        .from(schema.books)
        .where(eq(schema.books.status, "confirmed")),
      db
        .select({ n: count() })
        .from(schema.books)
        .where(gt(schema.books.createdAt, sql`NOW() - INTERVAL '7 days'`)),
      getBudget(),
      // Cross-batch pending-review queue, worst-confidence first so triage
      // surfaces the rows most likely to need a real decision. Cap at 12
      // so the sidebar doesn't grow indefinitely.
      db
        .select({
          id: schema.books.id,
          batchId: schema.books.batchId,
          batchName: schema.batches.name,
          title: schema.books.title,
          authors: schema.books.authors,
          isbn13: schema.books.isbn13,
          isbn10: schema.books.isbn10,
          coverUrl: schema.books.coverUrl,
          source: schema.books.source,
          confidence: schema.books.confidence,
        })
        .from(schema.books)
        .innerJoin(
          schema.batches,
          eq(schema.books.batchId, schema.batches.id),
        )
        .where(eq(schema.books.status, "pending_review"))
        .orderBy(asc(sql`COALESCE(${schema.books.confidence}, 1)`))
        .limit(12),
    ]);

  const pendingBooks: PendingBook[] = pendingBooksRaw.map((b) => ({
    id: b.id,
    batchId: b.batchId,
    batchName: b.batchName,
    title: b.title,
    authors: b.authors,
    isbn13: b.isbn13,
    isbn10: b.isbn10,
    coverUrl: b.coverUrl,
    source: b.source,
    confidence: b.confidence,
  }));

  // QuickAddBar needs a small slice of batch data; reuse the existing rows.
  const quickAddBatches = batches.map((b) => ({
    id: b.id,
    name: b.name,
    location: b.location,
  }));

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">
        {/* On wide screens: main content (2/3) + pending-review sidebar (1/3).
            Hero lives inside the main column so it aligns with the rest
            of the homepage flow rather than breaking out across both
            columns. On phone/tablet: stacks single-column. */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-8 lg:col-span-2">
            {/* Hero */}
            <section className="from-primary/8 via-background to-background relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 sm:p-8">
              <div className="from-primary/15 pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gradient-to-br to-transparent blur-3xl" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-2">
                  <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
                    <Sparkles className="size-3" />
                    Your library
                  </div>
                  <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                    Welcome back
                  </h1>
                  <p className="text-muted-foreground max-w-md text-sm">
                    Photograph shelves, scan barcodes, then export everything to
                    LibraryThing in one tidy CSV.
                  </p>
                </div>
                <CreateBatchDialog />
              </div>
            </section>

            {/* Quick-add ISBN — single-keystroke entry into a chosen batch */}
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="font-heading text-base font-semibold tracking-tight">
                  Quick add
                </h2>
                <span className="text-muted-foreground text-[11px]">
                  ISBN → lookup → into the batch you pick
                </span>
              </div>
              <QuickAddBar batches={quickAddBatches} />
            </section>

            {/* Stats */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                icon={<BookMarked className="size-4" />}
                label="Books cataloged"
                value={totalBooks}
              />
              <StatTile
                icon={<BookCheck className="size-4" />}
                label="Confirmed"
                value={confirmedBooks}
              />
              <StatTile
                icon={<Library className="size-4" />}
                label="Batches"
                value={batches.length}
              />
              <StatTile
                icon={<Clock className="size-4" />}
                label="This week"
                value={weeklyBooks}
              />
            </section>

            {/* Batches */}
            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="font-heading text-xl font-semibold tracking-tight">
                  Batches
                </h2>
                <span className="text-muted-foreground text-xs">
                  Vision API: {budget.used} / {budget.limit} today
                </span>
              </div>

              {batches.length === 0 ? (
                <EmptyBatches />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {batches.map((b) => (
                    <li key={b.id}>
                      <Link href={`/batches/${b.id}`} className="group block">
                        <Card className="hover:border-primary/40 hover:-translate-y-0.5 overflow-hidden transition-all hover:shadow-md">
                          <CardContent className="flex items-center gap-4 p-4">
                            <CoverStack books={b.sampleBooks} title={b.name} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <div className="font-heading group-hover:text-primary truncate text-base font-semibold transition-colors">
                                  {b.name}
                                </div>
                              </div>
                              {b.location && (
                                <div className="text-muted-foreground truncate text-xs">
                                  {b.location}
                                </div>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                                <span className="text-foreground font-medium">
                                  {b.bookCount}{" "}
                                  {b.bookCount === 1 ? "book" : "books"}
                                </span>
                                {b.confirmedCount > 0 && (
                                  <span className="text-primary">
                                    {b.confirmedCount} ready
                                  </span>
                                )}
                                {b.exportedAt && (
                                  <span className="text-primary inline-flex items-center gap-0.5">
                                    <Check className="size-3" />
                                    Sent
                                  </span>
                                )}
                                <span className="text-muted-foreground ml-auto">
                                  {b.createdAt.toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-3 lg:col-span-1">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-xl font-semibold tracking-tight">
                Pending review
              </h2>
              {pendingBooks.length > 0 && (
                <span className="text-muted-foreground text-xs">
                  {pendingBooks.length} shown
                </span>
              )}
            </div>
            <PendingReviewPanel books={pendingBooks} />
          </aside>
        </div>
      </main>
    </>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-card hover:border-primary/30 rounded-xl border p-4 transition-colors">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="font-heading mt-1 text-2xl font-semibold tracking-tight">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

type SampleBook = {
  coverUrl: string | null;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
};

function CoverStack({ books, title }: { books: SampleBook[]; title: string }) {
  // Three-deep visual stack, fanned slightly. Empty / missing slots show the
  // same fallback as a single cover so batches with zero confirmed books
  // still render cleanly.
  const slots: (SampleBook | null)[] = [
    books[0] ?? null,
    books[1] ?? null,
    books[2] ?? null,
  ];

  return (
    <div className="relative h-20 w-16 shrink-0">
      {slots.map((book, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${i * 6}px`,
            top: `${i * 2}px`,
            transform: `rotate(${(i - 1) * 3}deg)`,
            zIndex: slots.length - i,
          }}
        >
          <BookCover
            coverUrl={book?.coverUrl}
            isbn13={book?.isbn13}
            isbn10={book?.isbn10}
            title={book?.title ?? title}
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}

function EmptyBatches() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <ShelfIllustration />
        <div className="space-y-1">
          <p className="font-heading text-base font-semibold">Your shelves are empty</p>
          <p className="text-muted-foreground max-w-xs text-sm">
            Create your first batch to start photographing, scanning, and cataloging
            books.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ShelfIllustration() {
  return (
    <svg
      viewBox="0 0 200 120"
      className="text-primary/40 h-24 w-auto"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Shelf line */}
      <line x1="20" y1="100" x2="180" y2="100" />
      {/* Books */}
      <rect x="35" y="55" width="14" height="45" rx="2" />
      <rect x="52" y="62" width="12" height="38" rx="2" />
      <rect x="67" y="50" width="16" height="50" rx="2" />
      <rect x="86" y="58" width="13" height="42" rx="2" />
      <rect
        x="103"
        y="48"
        width="12"
        height="52"
        rx="2"
        transform="rotate(8 109 74)"
      />
      <rect x="125" y="60" width="15" height="40" rx="2" />
      <rect x="143" y="54" width="14" height="46" rx="2" />
      {/* Sparkle */}
      <path d="M165 35 L165 45 M160 40 L170 40" />
    </svg>
  );
}
