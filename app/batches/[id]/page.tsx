import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
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
import DeleteBatchButton from "@/components/DeleteBatchButton";
import RefreshButton from "@/components/RefreshButton";
import BulkConfirmButton from "@/components/BulkConfirmButton";
import ExportButton from "@/components/ExportButton";
import TopBar from "@/components/TopBar";
import BooksList from "@/components/BooksList";
import { getBudget } from "@/lib/vision-budget";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BULK_CONFIRM_THRESHOLD = 0.85;

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  show?: string;
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
  const { id } = await params;
  const { show, relookup, manual, source } = await searchParams;
  const showRejected = show === "all";

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

  const confirmedCount = books.filter((b) => b.status === "confirmed").length;
  const pendingCount = books.filter((b) => b.status === "pending_review").length;
  const rejectedCount = books.filter((b) => b.status === "rejected").length;
  const visibleBooks = showRejected
    ? books
    : books.filter((b) => b.status !== "rejected");
  const bulkEligibleCount = books.filter(
    (b) =>
      b.status === "pending_review" &&
      b.confidence !== null &&
      b.confidence >= BULK_CONFIRM_THRESHOLD,
  ).length;
  const budget = await getBudget();

  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
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
        <section className="from-primary/10 via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br shadow-sm">
          {/* Tartan corner ribbon — folds into the top-right corner of
              the hero, like a bookplate ribbon. Subtle textile signature
              that doesn't dominate the content. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 size-20 overflow-hidden"
          >
            <div
              className="absolute -right-8 top-3 h-5 w-32 rotate-45 shadow-sm"
              style={{
                backgroundImage: "url(/tartan.svg)",
                backgroundSize: "96px 96px",
              }}
            />
          </div>
          <div className="relative space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
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

              <div className="flex flex-wrap items-center gap-2">
                <RefreshButton />
                <BulkConfirmButton
                  batchId={batch.id}
                  eligibleCount={bulkEligibleCount}
                  threshold={BULK_CONFIRM_THRESHOLD}
                />
                <ExportButton batchId={batch.id} count={confirmedCount} />
                <DeleteBatchButton
                  batchId={batch.id}
                  batchName={batch.name}
                  bookCount={books.length}
                />
              </div>
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
              {rejectedCount > 0 && (
                <StatChip
                  count={rejectedCount}
                  label="rejected"
                  tone="rejected"
                />
              )}
            </div>

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
                    Enter an ISBN and submit — title, author, publisher, and cover
                    will fill in automatically. Other fields are only needed for
                    books without an ISBN.
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
                  <details className="group">
                    <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium">
                      <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                      No ISBN? Enter details manually
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

        {/* Books list */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              Books
              <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                ({visibleBooks.length})
              </span>
            </h2>
            {rejectedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                render={
                  <Link
                    href={
                      showRejected
                        ? `/batches/${batch.id}`
                        : `/batches/${batch.id}?show=all`
                    }
                  />
                }
              >
                {showRejected ? "Hide rejected" : `Show ${rejectedCount} rejected`}
              </Button>
            )}
          </div>

          {visibleBooks.length === 0 ? (
            <EmptyBooks hasAny={books.length > 0} />
          ) : (
            <BooksList batchId={batch.id} books={visibleBooks} />
          )}
        </section>

        {/* Tartan footer divider replaces the plain Separator — quiet
            textile signature at the foot of the page. */}
        <div
          aria-hidden="true"
          className="h-[2px] w-full"
          style={{
            backgroundImage: "url(/tartan.svg)",
            backgroundSize: "96px 96px",
            backgroundRepeat: "repeat-x",
          }}
        />
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
  tone?: "neutral" | "confirmed" | "pending" | "rejected";
}) {
  const styles = {
    neutral: "bg-background/60 border",
    confirmed: "bg-primary/10 text-primary border border-primary/25",
    pending: "bg-accent/15 text-accent-foreground border border-accent/30",
    rejected: "bg-muted text-muted-foreground border",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 backdrop-blur ${styles[tone]}`}
    >
      <span className="font-heading text-base font-semibold tabular-nums">
        {count}
      </span>
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

function EmptyBooks({ hasAny }: { hasAny: boolean }) {
  return (
    <Card className="relative overflow-hidden border-dashed">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{
          backgroundImage: "url(/tartan.svg)",
          backgroundSize: "96px 96px",
          backgroundRepeat: "repeat-x",
        }}
      />
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
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
          {hasAny
            ? "All books in this batch are rejected. Click “Show rejected” to see them."
            : "No books yet. Use Photo, Scan, or Manual above to add some."}
        </p>
      </CardContent>
    </Card>
  );
}

