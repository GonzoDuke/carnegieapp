"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, BellOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookCover } from "@/components/BookCover";

export type DuplicateBook = {
  id: string;
  batchId: string;
  batchName: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  status: "pending_review" | "confirmed" | "rejected";
  // Pre-formatted on the server so we don't run toLocaleDateString on both
  // sides of the hydration boundary (locale mismatch warnings).
  addedLabel: string;
};

export type DuplicateGroup = {
  isbn: string;
  books: DuplicateBook[];
};

export default function DuplicatesList({
  groups,
  initialIgnored,
}: {
  groups: DuplicateGroup[];
  initialIgnored: boolean;
}) {
  const router = useRouter();
  // Optimistic mirror of the account-wide flag so the toggle feels instant;
  // reconciled by router.refresh() once the write lands. `busy` blocks a
  // second click while the request is in flight.
  const [ignored, setIgnored] = useState(initialIgnored);
  const [busy, setBusy] = useState(false);
  const copies = groups.reduce((n, g) => n + g.books.length, 0);

  async function setIgnore(next: boolean) {
    if (busy) return;
    const previous = ignored;
    setIgnored(next);
    setBusy(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoreDuplicates: next }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setIgnored(previous);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
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

        {/* One switch to mute the whole thing — banner included. Persisted
            account-wide so the choice follows you across devices. */}
        {groups.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setIgnore(!ignored)}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={
              ignored
                ? "Show duplicate warnings again"
                : "Hide every duplicate warning, here and the home-page banner"
            }
          >
            {ignored ? (
              <>
                <Bell className="size-3.5" />
                Show duplicates
              </>
            ) : (
              <>
                <BellOff className="size-3.5" />
                Ignore all duplicates
              </>
            )}
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No duplicates found.
          </CardContent>
        </Card>
      ) : ignored ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Ignoring {groups.length} possible{" "}
            {groups.length === 1 ? "duplicate" : "duplicates"} ({copies} copies
            across batches). The home-page banner is hidden too.{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => setIgnore(false)}
              className="text-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              Show them
            </button>
            .
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {groups.map((group) => (
            <li key={group.isbn}>
              <Card>
                <CardContent className="p-4">
                  <div className="text-muted-foreground mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
                    <span>ISBN</span>
                    <code className="bg-muted rounded px-1.5 py-0.5 font-mono normal-case tracking-normal">
                      {group.isbn}
                    </code>
                    <span>· {group.books.length} copies</span>
                  </div>
                  <ul className="space-y-2">
                    {group.books.map((book) => (
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
                          <p className="text-muted-foreground text-xs">
                            In{" "}
                            <Link
                              href={`/batches/${book.batchId}#book-${book.id}`}
                              className="text-foreground hover:underline"
                            >
                              {book.batchName}
                            </Link>{" "}
                            · added {book.addedLabel}
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
