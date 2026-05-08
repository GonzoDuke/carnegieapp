"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookCover } from "@/components/BookCover";

export type PendingBook = {
  id: string;
  batchId: string;
  batchName: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  source: "vision" | "barcode" | "manual";
  confidence: number | null;
};

type Props = {
  books: PendingBook[];
};

// Workbench-board layout: 2-up grid of substantial cards. Each card carries
// a medium-sized cover, the title + authors, batch + source + confidence
// metadata, and full-width Confirm / Delete buttons. Pending review is the
// primary work surface on the home page, so the cards are sized to feel
// like things you act on, not list rows you scan.
export default function PendingReviewPanel({ books }: Props) {
  const router = useRouter();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  if (books.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-base">
          <Check className="text-primary size-6" />
          <span>All caught up. No pending books across your batches.</span>
        </CardContent>
      </Card>
    );
  }

  async function decide(book: PendingBook, action: "confirm" | "delete") {
    if (busyIds.has(book.id)) return;
    if (action === "delete" && !window.confirm(`Delete "${book.title}"? This cannot be undone.`)) {
      return;
    }
    setBusyIds((prev) => new Set(prev).add(book.id));
    try {
      const form = new FormData();
      form.append("_action", action === "delete" ? "delete" : "save");
      if (action === "confirm") form.append("status", "confirmed");
      const res = await fetch(
        `/api/batches/${book.batchId}/books/${book.id}`,
        { method: "POST", body: form, redirect: "manual" },
      );
      // The route returns a 303 redirect to /batches/[id]; treat any non-error
      // response as success. fetch with redirect:"manual" gives an opaque
      // response (status 0 / type opaqueredirect), which counts as ok here.
      if (!res.ok && res.type !== "opaqueredirect" && res.status !== 0) {
        throw new Error(`Failed (${res.status})`);
      }
      toast.success(
        action === "confirm" ? `Confirmed: ${book.title}` : `Deleted: ${book.title}`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
    }
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {books.map((book) => {
        const busy = busyIds.has(book.id);
        const dot = confidenceDot(book.source, book.confidence);
        return (
          <li key={book.id}>
            <Card className="overflow-hidden">
              <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex items-start gap-4">
                  <BookCover
                    coverUrl={book.coverUrl}
                    isbn13={book.isbn13}
                    isbn10={book.isbn10}
                    title={book.title}
                    size="md"
                    className="ring-accent/20 ring-1"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-heading line-clamp-2 text-lg font-semibold leading-snug">
                      {book.title}
                    </p>
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {book.authors.length > 0
                        ? book.authors.join(" / ")
                        : "Unknown author"}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs">
                      <Link
                        href={`/batches/${book.batchId}#book-${book.id}`}
                        className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      >
                        In: {book.batchName}
                      </Link>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{book.source}</span>
                      {dot && (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={`inline-block size-2 rounded-full ${dot}`}
                            aria-hidden="true"
                          />
                          <span className="text-muted-foreground tabular-nums">
                            {book.confidence?.toFixed(2)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => decide(book, "confirm")}
                    disabled={busy}
                    className="flex-1"
                  >
                    <Check className="size-4" />
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => decide(book, "delete")}
                    disabled={busy}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive flex-1"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function confidenceDot(
  source: "vision" | "barcode" | "manual",
  confidence: number | null,
): string | null {
  if (source !== "vision" || confidence === null) return null;
  if (confidence >= 0.85) return "bg-emerald-500";
  if (confidence >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}
