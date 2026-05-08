import Link from "next/link";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { AlertTriangle, ArrowRight, Check, Sparkles } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
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

const PENDING_BOARD_LIMIT = 4;

export default async function HomePage() {
  const userId = await requireUserId();
  const db = getDb();

  const [batches, [{ n: totalPending }], budget, pendingBoardRaw, duplicateGroups] =
    await Promise.all([
      db
        .select({
          id: schema.batches.id,
          name: schema.batches.name,
          location: schema.batches.location,
          createdAt: schema.batches.createdAt,
          exportedAt: schema.batches.exportedAt,
          bookCount: sql<number>`(SELECT COUNT(*)::int FROM ${schema.books} WHERE ${schema.books.batchId} = ${schema.batches.id})`,
          confirmedCount: sql<number>`(SELECT COUNT(*)::int FROM ${schema.books} WHERE ${schema.books.batchId} = ${schema.batches.id} AND ${schema.books.status} = 'confirmed')`,
          pendingCount: sql<number>`(SELECT COUNT(*)::int FROM ${schema.books} WHERE ${schema.books.batchId} = ${schema.batches.id} AND ${schema.books.status} = 'pending_review')`,
          // Last book added (or batch created if empty) — drives the "where
          // you left off" link and the per-batch "edited Xh ago" line.
          lastActivity: sql<Date>`COALESCE(
            (SELECT MAX(created_at) FROM ${schema.books} WHERE ${schema.books.batchId} = ${schema.batches.id}),
            ${schema.batches.createdAt}
          )`,
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
              LIMIT 8
            ) sub
          )`,
        })
        .from(schema.batches)
        .where(eq(schema.batches.ownerId, userId))
        .orderBy(desc(schema.batches.createdAt)),
      db
        .select({ n: count() })
        .from(schema.books)
        .where(
          and(
            eq(schema.books.ownerId, userId),
            eq(schema.books.status, "pending_review"),
          ),
        ),
      getBudget(userId),
      // Worst-confidence-first slice of cross-batch pending books, capped to
      // what fits on the workbench board (4). The full triage queue lives on
      // /search?status=pending_review when the user wants to see more.
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
        .where(
          and(
            eq(schema.books.ownerId, userId),
            eq(schema.books.status, "pending_review"),
          ),
        )
        .orderBy(asc(sql`COALESCE(${schema.books.confidence}, 1)`))
        .limit(PENDING_BOARD_LIMIT),
      db
        .select({
          canonical: sql<string>`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10})`,
        })
        .from(schema.books)
        .where(
          and(
            eq(schema.books.ownerId, userId),
            sql`${schema.books.isbn13} IS NOT NULL OR ${schema.books.isbn10} IS NOT NULL`,
          ),
        )
        .groupBy(
          sql`COALESCE(${schema.books.isbn13}, ${schema.books.isbn10})`,
        )
        .having(sql`COUNT(*) > 1`),
    ]);

  const pendingBoard: PendingBook[] = pendingBoardRaw.map((b) => ({
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

  // lastActivity is a raw sql<Date> expression, which Drizzle's runtime
  // doesn't auto-parse — the Neon HTTP driver hands it back as an ISO
  // string. Normalize once here so everything downstream can treat it as
  // a real Date.
  const normalizedBatches = batches.map((b) => ({
    ...b,
    lastActivity:
      b.lastActivity instanceof Date
        ? b.lastActivity
        : new Date(b.lastActivity as unknown as string),
  }));

  // Open = still being worked on (no exportedAt). Sent = already shipped to
  // LibraryThing; lives in the archive footer rather than the active queue.
  // Open batches are sorted by recent activity so the one you most likely
  // want to resume sits at the top.
  const openBatches = normalizedBatches
    .filter((b) => b.exportedAt === null)
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  const sentBatches = normalizedBatches
    .filter((b) => b.exportedAt !== null)
    .sort((a, b) => b.exportedAt!.getTime() - a.exportedAt!.getTime());

  const lastEdit = openBatches[0] ?? null;

  const quickAddBatches = batches.map((b) => ({
    id: b.id,
    name: b.name,
    location: b.location,
  }));

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-5xl space-y-12 px-4 py-8 sm:py-10">
        {/* In-flight status — big serif statement of work state, plus a
            "where you left off" link to the most recently active batch.
            This replaces the old welcome hero / 4-up stat tiles; this
            page is a workbench, not a library showcase. */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.2em]">
              <Sparkles className="size-3" />
              In flight
            </p>
            <CreateBatchDialog />
          </div>

          <h1 className="font-heading text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            <span className="tabular-nums">{totalPending}</span>{" "}
            <span className="text-muted-foreground">
              {totalPending === 1 ? "book" : "books"} waiting.
            </span>
            <br />
            <span className="tabular-nums">{openBatches.length}</span>{" "}
            <span className="text-muted-foreground">
              {openBatches.length === 1 ? "batch" : "batches"} open.
            </span>
          </h1>

          {lastEdit && (
            <Link
              href={`/batches/${lastEdit.id}`}
              className="text-foreground hover:text-primary group inline-flex items-center gap-1.5 text-base transition-colors"
            >
              Last edit:{" "}
              <span className="font-medium">{lastEdit.name}</span>,{" "}
              {formatRelative(lastEdit.lastActivity)}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </section>

        {duplicateGroups.length > 0 && (
          <Link href="/duplicates" className="block">
            <Card className="border-destructive/30 bg-destructive/5 hover:border-destructive/50 transition-colors">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="bg-destructive/15 text-destructive flex size-9 shrink-0 items-center justify-center rounded-full">
                  <AlertTriangle className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-base font-medium">
                    {duplicateGroups.length} possible{" "}
                    {duplicateGroups.length === 1 ? "duplicate" : "duplicates"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Same ISBN appears in multiple batches — review and delete
                    extras.
                  </p>
                </div>
                <ArrowRight className="text-muted-foreground size-4" />
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Quick add ISBN — primary single-keystroke entry into a batch. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              Quick add
            </h2>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              ISBN → lookup → into the batch you pick
            </span>
          </div>
          <QuickAddBar batches={quickAddBatches} />
        </section>

        {/* Needs your decision — pending review board. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              Needs your decision
              {totalPending > 0 && (
                <span className="text-muted-foreground ml-2 text-base font-normal tabular-nums">
                  · {totalPending}
                </span>
              )}
            </h2>
            {totalPending > pendingBoard.length && (
              <Link
                href="/search?status=pending_review&sort=confidence"
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
              >
                show {totalPending - pendingBoard.length} more
                <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
          <PendingReviewPanel books={pendingBoard} />
        </section>

        {/* Open batches — full-width project cards. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
              Batches open
              {openBatches.length > 0 && (
                <span className="text-muted-foreground ml-2 text-base font-normal tabular-nums">
                  · {openBatches.length}
                </span>
              )}
            </h2>
          </div>

          {openBatches.length === 0 ? (
            <EmptyBatches />
          ) : (
            <ul className="space-y-3">
              {openBatches.map((b) => (
                <li key={b.id}>
                  <BatchCard batch={b} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {sentBatches.length > 0 && (
          <section className="space-y-3 border-t pt-8">
            <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
              Already sent to LibraryThing · {sentBatches.length}
            </h2>
            <ul className="grid gap-2 text-base sm:grid-cols-2">
              {sentBatches.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/batches/${b.id}`}
                    className="hover:bg-muted/50 group flex items-center gap-2 rounded-md px-2 py-2 transition-colors"
                  >
                    <Check className="text-primary size-4 shrink-0" />
                    <span className="text-foreground truncate font-medium">
                      {b.name}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      ({b.bookCount})
                    </span>
                    <span className="text-muted-foreground ml-auto text-sm">
                      {b.exportedAt!.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="text-muted-foreground border-t pt-6 text-xs">
          Vision API: {budget.used} / {budget.limit} used today (UTC).
        </footer>
      </main>
    </>
  );
}

type BatchRow = {
  id: string;
  name: string;
  location: string | null;
  createdAt: Date;
  exportedAt: Date | null;
  bookCount: number;
  confirmedCount: number;
  pendingCount: number;
  lastActivity: Date;
  sampleBooks: Array<{
    coverUrl: string | null;
    isbn13: string | null;
    isbn10: string | null;
    title: string;
  }>;
};

// Full-width project card for an in-flight batch. Cover strip across the
// top (up to 8 thumbnails) gives the batch presence and lets the eye scan
// what's inside; progress bar + counts + last-edit timestamp give the
// status at a glance. Whole card is a link into /batches/[id].
function BatchCard({ batch }: { batch: BatchRow }) {
  const pct =
    batch.bookCount > 0
      ? Math.round((batch.confirmedCount / batch.bookCount) * 100)
      : 0;
  const readyToExport =
    batch.bookCount > 0 && batch.confirmedCount === batch.bookCount;

  return (
    <Link href={`/batches/${batch.id}`} className="group block">
      <Card className="hover:border-primary/40 hover:shadow-md overflow-hidden transition-all">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h3 className="font-heading group-hover:text-primary text-xl font-semibold tracking-tight transition-colors sm:text-2xl">
                {batch.name}
              </h3>
              {batch.location && (
                <p className="text-muted-foreground text-sm">
                  {batch.location}
                </p>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {batch.bookCount}{" "}
              {batch.bookCount === 1 ? "book" : "books"}
              {" · edited "}
              {formatRelative(batch.lastActivity)}
            </p>
          </div>

          {batch.sampleBooks.length > 0 ? (
            <div className="flex gap-2 overflow-hidden">
              {batch.sampleBooks.map((book, i) => (
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
          ) : (
            <div className="bg-muted/40 text-muted-foreground flex h-[4.5rem] items-center justify-center rounded-md border border-dashed text-sm">
              No confirmed books yet
            </div>
          )}

          <div className="space-y-2">
            <div className="bg-muted relative h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-primary absolute inset-y-0 left-0 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
              <span className="text-foreground font-semibold tabular-nums">
                {pct}%
              </span>
              <span>confirmed</span>
              {batch.pendingCount > 0 && (
                <>
                  <span>·</span>
                  <span>
                    <span className="text-foreground font-medium tabular-nums">
                      {batch.pendingCount}
                    </span>{" "}
                    pending
                  </span>
                </>
              )}
              {readyToExport && (
                <span className="text-primary ml-auto inline-flex items-center gap-1 font-medium">
                  <Check className="size-3.5" />
                  Ready to export
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyBatches() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <ShelfIllustration />
        <div className="space-y-1">
          <p className="font-heading text-lg font-semibold">
            No batches in flight
          </p>
          <p className="text-muted-foreground max-w-xs text-base">
            Create a batch to start photographing, scanning, and cataloging
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
      <line x1="20" y1="100" x2="180" y2="100" />
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
      <path d="M165 35 L165 45 M160 40 L170 40" />
    </svg>
  );
}

// Compact relative-time string for "edited 2h ago" / "edited Mar 14".
// Past-only — we don't render future timestamps anywhere on this page.
function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 2 * minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
