import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireUserId } from "@/lib/auth";
import {
  ArrowLeft,
  BookPlus,
  Camera,
  Check,
  ChevronRight,
  Pencil,
  ScanBarcode,
  Sparkles,
} from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import BarcodeScanner from "@/components/BarcodeScanner";
import PhotoCapture from "@/components/PhotoCapture";
import BatchActionsMenu from "@/components/BatchActionsMenu";
import BulkConfirmButton from "@/components/BulkConfirmButton";
import ExportButton from "@/components/ExportButton";
import TopBar from "@/components/TopBar";
import BooksList from "@/components/BooksList";
import BatchPhotos from "@/components/BatchPhotos";
import { getBudget } from "@/lib/vision-budget";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BULK_CONFIRM_THRESHOLD = 0.85;

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  relookup?: string;
  manual?: string;
  source?: string;
}>;

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const { relookup, manual, source } = await searchParams;

  const db = getDb();
  // Filter by both id and ownerId so a batch belonging to another user
  // 404s rather than reveals existence.
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(
      and(eq(schema.batches.id, id), eq(schema.batches.ownerId, userId)),
    )
    .limit(1);
  if (!batch) notFound();

  const books = await db
    .select()
    .from(schema.books)
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.ownerId, userId),
      ),
    )
    // Books from a vision photo carry a 1-based left-to-right index;
    // manual entries and recrops have NULL position. Sort positioned
    // books first by their shelf order, then everything else by
    // creation time so newly-added books accrete at the end.
    .orderBy(
      sql`${schema.books.position} NULLS LAST`,
      asc(schema.books.createdAt),
    );

  const uploads = await db
    .select()
    .from(schema.batchUploads)
    .where(
      and(
        eq(schema.batchUploads.batchId, id),
        eq(schema.batchUploads.ownerId, userId),
      ),
    );

  const confirmedCount = books.filter((b) => b.status === "confirmed").length;
  const pendingCount = books.filter((b) => b.status === "pending_review").length;
  const bulkEligibleCount = books.filter(
    (b) =>
      b.status === "pending_review" &&
      b.confidence !== null &&
      b.confidence >= BULK_CONFIRM_THRESHOLD,
  ).length;
  // Books that would benefit from quick-fill: pending review with no ISBN
  // yet. With an ISBN they already got a lookup at insert; re-running is
  // wasted budget.
  const quickFillCount = books.filter(
    (b) => b.status === "pending_review" && !b.isbn13 && !b.isbn10,
  ).length;
  const budget = await getBudget(userId);

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          <ArrowLeft className="size-3" />
          All batches
        </Link>

        {(relookup === "hit" || manual === "hit") && (
          <Alert className="border-primary/40 bg-primary/5">
            <Sparkles className="size-4" />
            <AlertDescription>
              {relookup === "hit" ? "Lookup refreshed" : "Book added"}
              {source ? ` from ${source}` : ""}. Title, author, publisher, and
              cover filled in automatically.
            </AlertDescription>
          </Alert>
        )}
        {relookup === "miss" && (
          <Alert>
            <AlertDescription>
              Re-lookup didn&apos;t find a match. Your edits were saved but no
              additional fields could be filled in.
            </AlertDescription>
          </Alert>
        )}
        {manual === "miss" && (
          <Alert>
            <AlertDescription>
              No match found for that ISBN. Book added as a draft — open it
              below to edit, or click Re-lookup to try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Hero header with batch identity + actions */}
        <section className="from-primary/8 via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br shadow-sm">
          <div className="from-primary/12 pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-gradient-to-br to-transparent blur-3xl" />
          <div className="relative space-y-4 p-5 sm:p-6">
            {/* Title row — batch identity on the left, overflow menu
                (Refresh / Delete) on the right. The primary actions
                row sits below. This split keeps the hero readable on
                mobile where five wrapping buttons used to dominate. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="font-heading truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                  {batch.name}
                </h1>
                {batch.location && (
                  <p className="text-muted-foreground text-sm">{batch.location}</p>
                )}
                {batch.notes && (
                  <p className="text-muted-foreground/80 max-w-prose pt-1 text-xs">
                    {batch.notes}
                  </p>
                )}
              </div>

              <BatchActionsMenu
                batchId={batch.id}
                batchName={batch.name}
                bookCount={books.length}
              />
            </div>

            {/* Inline stats */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatChip count={books.length} label="total" />
              <StatChip
                count={confirmedCount}
                label="confirmed"
                tone="confirmed"
              />
              <StatChip count={pendingCount} label="pending" tone="pending" />
            </div>

            {/* Primary actions — only render when they actually apply.
                Quick-fill is hidden when no pending books are missing
                ISBN; BulkConfirmButton returns null at 0 eligible;
                ExportButton returns null at 0 confirmed. So an empty
                or all-exported batch produces no row at all. */}
            {(quickFillCount > 0 ||
              bulkEligibleCount > 0 ||
              confirmedCount > 0) && (
              <div className="flex flex-wrap items-center gap-2">
                {quickFillCount > 0 && (
                  <Link
                    href={`/batches/${batch.id}/quick-fill`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Sparkles className="size-4" />
                    Quick-fill ISBNs ({quickFillCount})
                  </Link>
                )}
                <BulkConfirmButton
                  batchId={batch.id}
                  eligibleCount={bulkEligibleCount}
                  threshold={BULK_CONFIRM_THRESHOLD}
                />
                <ExportButton batchId={batch.id} count={confirmedCount} />
              </div>
            )}

            {batch.exportedAt && (
              <div className="text-primary inline-flex items-center gap-1 text-[11px] font-medium">
                <Check className="size-3" />
                <span>
                  Sent to LibraryThing{" "}
                  {batch.exportedAt.toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            )}

            {/* Edit batch info disclosure */}
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium transition-colors">
                <Pencil className="size-3" />
                <span>Edit batch info</span>
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
              </summary>
              <form
                method="POST"
                action={`/api/batches/${batch.id}`}
                className="bg-background/60 mt-3 space-y-3 rounded-lg border p-4 backdrop-blur"
              >
                <input type="hidden" name="_action" value="update" />
                <div className="grid gap-2">
                  <Label htmlFor="batch-name">Name</Label>
                  <Input
                    id="batch-name"
                    type="text"
                    name="name"
                    defaultValue={batch.name}
                    required
                    maxLength={200}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="batch-location">Location</Label>
                  <Input
                    id="batch-location"
                    type="text"
                    name="location"
                    defaultValue={batch.location ?? ""}
                    placeholder="e.g. Garage"
                    maxLength={200}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="batch-notes">Notes</Label>
                  <Input
                    id="batch-notes"
                    type="text"
                    name="notes"
                    defaultValue={batch.notes ?? ""}
                    maxLength={2000}
                  />
                </div>
                <Button type="submit" size="sm">
                  Save changes
                </Button>
              </form>
            </details>
          </div>
        </section>

        {/* Add book — tabs */}
        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="photo">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="photo">
                  <Camera className="size-3.5" />
                  Photo
                </TabsTrigger>
                <TabsTrigger value="scan">
                  <ScanBarcode className="size-3.5" />
                  Scan
                </TabsTrigger>
                <TabsTrigger value="manual">
                  <BookPlus className="size-3.5" />
                  Manual
                </TabsTrigger>
              </TabsList>

              <TabsContent value="photo" className="pt-4">
                <PhotoCapture batchId={batch.id} />
              </TabsContent>

              <TabsContent value="scan" className="pt-4">
                <BarcodeScanner batchId={batch.id} />
              </TabsContent>

              <TabsContent value="manual" className="pt-4">
                <form
                  method="POST"
                  action={`/api/batches/${batch.id}/books`}
                  className="space-y-3"
                >
                  <p className="text-muted-foreground text-xs">
                    Enter an ISBN — or, for older books without one, an LCCN
                    (Library of Congress Control Number). Title, author,
                    publisher, and cover fill in automatically when the
                    lookup succeeds.
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="manual-isbn">
                      ISBN
                      <span className="text-muted-foreground ml-1 font-normal">
                        (recommended)
                      </span>
                    </Label>
                    <Input
                      id="manual-isbn"
                      type="text"
                      name="isbn"
                      placeholder="ISBN-10 or ISBN-13 (hyphens OK)"
                      maxLength={20}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="manual-lccn">
                      LCCN
                      <span className="text-muted-foreground ml-1 font-normal">
                        (older books)
                      </span>
                    </Label>
                    <Input
                      id="manual-lccn"
                      type="text"
                      name="lccn"
                      placeholder="e.g. 78890351 or n78890351"
                      maxLength={30}
                    />
                  </div>
                  <details className="group">
                    <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium">
                      <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                      No ISBN or LCCN? Enter details manually
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2">
                        <Label htmlFor="manual-title">Title</Label>
                        <Input
                          id="manual-title"
                          type="text"
                          name="title"
                          maxLength={1000}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="manual-authors">Authors</Label>
                        <Input
                          id="manual-authors"
                          type="text"
                          name="authors"
                          placeholder="Comma-separated authors"
                          maxLength={1000}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor="manual-publisher">Publisher</Label>
                          <Input
                            id="manual-publisher"
                            type="text"
                            name="publisher"
                            maxLength={200}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="manual-pubdate">Publication date</Label>
                          <Input
                            id="manual-pubdate"
                            type="text"
                            name="pubDate"
                            placeholder="e.g. 2023"
                            maxLength={100}
                          />
                        </div>
                      </div>
                    </div>
                  </details>
                  <Button type="submit" className="w-full">
                    <BookPlus className="size-4" />
                    Add book
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <BatchPhotos uploads={uploads} />

        {/* Books list — BooksList owns its own header row (title +
            book count + expand/collapse-all toggle). Empty state
            gets the title here so the section still reads naturally
            with no books. */}
        <section className="space-y-3">
          {books.length === 0 ? (
            <>
              <h2 className="font-heading text-lg font-semibold tracking-tight">
                Books
                <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                  (0)
                </span>
              </h2>
              <EmptyBooks />
            </>
          ) : (
            <BooksList batchId={batch.id} books={books} />
          )}
        </section>

        <Separator />
        <footer className="text-muted-foreground text-[11px]">
          Vision API: {budget.used} / {budget.limit} used today (UTC).
          {budget.exhausted && " Cap hit — photo extraction disabled until tomorrow."}
        </footer>
      </main>
    </>
  );
}

function StatChip({
  count,
  label,
  tone = "neutral",
}: {
  count: number;
  label: string;
  tone?: "neutral" | "confirmed" | "pending";
}) {
  const styles = {
    neutral: "bg-background/60 border",
    confirmed: "bg-primary/10 text-primary border border-primary/20",
    pending: "bg-amber-500/10 text-amber-700 border border-amber-500/20 dark:text-amber-300",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur ${styles[tone]}`}
    >
      <span className="font-heading text-sm font-semibold tabular-nums">
        {count}
      </span>
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

function EmptyBooks() {
  return (
    <Card className="relative overflow-hidden border-dashed">
      {/* Faint tartan watermark — mirrors the home page's empty
          batch-list card. Identity at boundary moments. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.06]"
        style={{ backgroundImage: "url(/tartanImagePrototype.jpg)" }}
      />
      <CardContent className="relative flex flex-col items-center gap-3 px-6 py-12 text-center">
        <svg
          viewBox="0 0 100 100"
          className="text-primary/40 h-16 w-auto"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="20" y="30" width="14" height="50" rx="2" />
          <rect x="38" y="35" width="12" height="45" rx="2" />
          <rect x="54" y="25" width="14" height="55" rx="2" />
          <rect x="72" y="40" width="10" height="40" rx="2" />
          <line x1="15" y1="80" x2="85" y2="80" />
        </svg>
        <p className="text-muted-foreground max-w-xs text-sm">
          No books yet. Use Photo, Scan, or Manual above to add some.
        </p>
      </CardContent>
    </Card>
  );
}

