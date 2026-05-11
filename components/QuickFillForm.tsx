"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Book } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BookCover } from "@/components/BookCover";

type Props = {
  batchId: string;
  books: Book[];
};

export default function QuickFillForm({ batchId, books }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function setIsbn(bookId: string, value: string) {
    setValues((prev) => ({ ...prev, [bookId]: value }));
  }

  const filledCount = Object.values(values).filter((v) => v.trim()).length;

  async function submit() {
    const updates = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([bookId, isbn]) => ({ bookId, isbn: isbn.trim() }));
    if (updates.length === 0) {
      toast.error("Type at least one ISBN to submit.");
      return;
    }
    setBusy(true);
    const toastId = toast.loading(
      `Looking up ${updates.length} book${updates.length === 1 ? "" : "s"}…`,
    );
    try {
      const res = await fetch(`/api/batches/${batchId}/books/bulk-relookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const json = (await res.json().catch(() => null)) as {
        hits?: number;
        misses?: number;
        valid?: number;
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? `Lookup failed (${res.status})`);
      }
      const hits = json?.hits ?? 0;
      const misses = json?.misses ?? 0;
      toast.success(
        `${hits} filled${misses ? `, ${misses} not found` : ""}.`,
        {
          id: toastId,
          description: misses
            ? "The missed ISBNs were saved — re-lookup later if you want to retry."
            : undefined,
        },
      );
      router.push(`/batches/${batchId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        id: toastId,
      });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {books.map((book) => (
          <Card key={book.id} className="overflow-hidden">
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
              <Input
                type="text"
                inputMode="numeric"
                placeholder="ISBN"
                className="w-36 sm:w-44"
                value={values[book.id] ?? ""}
                onChange={(e) => setIsbn(book.id, e.target.value)}
                maxLength={20}
                disabled={busy}
                autoComplete="off"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-card sticky bottom-2 flex items-center justify-between gap-3 rounded-lg border p-3 shadow-sm">
        <p className="text-muted-foreground text-xs">
          {filledCount} of {books.length} filled
        </p>
        <Button onClick={submit} disabled={busy || filledCount === 0}>
          <Sparkles className="size-4" />
          {busy ? "Looking up…" : `Fill ${filledCount || ""}`}
        </Button>
      </div>
    </div>
  );
}
