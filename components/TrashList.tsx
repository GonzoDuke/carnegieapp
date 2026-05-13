"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Book } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookCover } from "@/components/BookCover";

type Props = {
  batchId: string;
  books: Book[];
};

// Minimal list for rejected books. Mirrors the BooksList card shape
// so the visual identity stays consistent, but the actions are
// Restore (→ pending) and Delete forever (→ hard DB delete) instead
// of the full edit form / Confirm / Reject set.
export default function TrashList({ batchId, books }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Set<string>>(new Set());

  async function act(book: Book, action: "restore" | "permanent-delete") {
    if (busy.has(book.id)) return;
    if (action === "permanent-delete") {
      const ok = window.confirm(
        `Delete "${book.title}" forever? This can't be undone.`,
      );
      if (!ok) return;
    }
    setBusy((prev) => new Set(prev).add(book.id));
    try {
      const form = new FormData();
      form.append("_action", action);
      const res = await fetch(
        `/api/batches/${batchId}/books/${book.id}`,
        { method: "POST", body: form, redirect: "manual" },
      );
      // Same redirect handling as PendingReviewPanel — route returns
      // 303; fetch's manual redirect gives an opaqueredirect we treat
      // as success.
      if (!res.ok && res.type !== "opaqueredirect" && res.status !== 0) {
        throw new Error(`Failed (${res.status})`);
      }
      toast.success(
        action === "restore"
          ? `Restored "${book.title}"`
          : `Deleted "${book.title}" forever`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
    }
  }

  return (
    <ul className="space-y-2">
      {books.map((book) => {
        const working = busy.has(book.id);
        return (
          <li key={book.id} id={`book-${book.id}`} className="scroll-mt-20">
            <Card className="opacity-80">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="shrink-0">
                  <BookCover
                    coverUrl={book.coverUrl}
                    isbn13={book.isbn13}
                    isbn10={book.isbn10}
                    title={book.title}
                    size="xs"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {book.title || "(no title)"}
                  </p>
                  {book.authors.length > 0 && (
                    <p className="text-muted-foreground truncate text-xs">
                      {book.authors.join(" / ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => act(book, "restore")}
                    disabled={working}
                    title="Restore — moves back to pending review"
                    className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  >
                    <Undo2 className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => act(book, "permanent-delete")}
                    disabled={working}
                    title="Delete forever — irreversible"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
