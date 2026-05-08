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

export default function PendingReviewPanel({ books }: Props) {
  const router = useRouter();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  if (books.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-center text-sm">
          <Check className="text-primary mx-auto mb-2 size-5" />
          All caught up. No pending books across your batches.
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
    <ul className="space-y-2">
      {books.map((book) => {
        const busy = busyIds.has(book.id);
        const dot = confidenceDot(book.source, book.confidence);
        return (
          <li key={book.id}>
            <Card className="overflow-hidden">
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
                  <div className="flex items-center gap-1.5">
                    {dot && (
                      <span
                        className={`inline-block size-2 shrink-0 rounded-full ${dot}`}
                        aria-label={`confidence ${book.confidence?.toFixed(2)}`}
                      />
                    )}
                    <p className="truncate text-sm font-medium">{book.title}</p>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {book.authors.length > 0
                      ? book.authors.join(" / ")
                      : "Unknown author"}
                  </p>
                  <Link
                    href={`/batches/${book.batchId}#book-${book.id}`}
                    className="text-muted-foreground hover:text-foreground inline-block text-[11px] underline-offset-2 hover:underline"
                  >
                    {book.batchName}
                  </Link>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => decide(book, "confirm")}
                    disabled={busy}
                    title="Confirm"
                    className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => decide(book, "delete")}
                    disabled={busy}
                    title="Delete"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
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
