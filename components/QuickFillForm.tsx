"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBarcode, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { Book } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BookCover } from "@/components/BookCover";
import BarcodeReader from "@/components/BarcodeReader";

type Props = {
  batchId: string;
  books: Book[];
};

export default function QuickFillForm({ batchId, books }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Cursor into `books` for continuous scan: which row gets the next scan.
  // Skipped rows advance past without filling.
  const [scanIndex, setScanIndex] = useState(0);
  // Brief flash banner inside the overlay after each successful scan.
  const [lastFlash, setLastFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setIsbn(bookId: string, value: string) {
    setValues((prev) => ({ ...prev, [bookId]: value }));
  }

  const filledCount = useMemo(
    () => Object.values(values).filter((v) => v.trim()).length,
    [values],
  );

  // The set of ISBNs already typed/scanned — used to reject a duplicate
  // scan (same barcode read twice in a row will already be deduped by
  // BarcodeReader, but the user could legitimately point at the same
  // book twice across the dedupe window). Stored as the digit-only form
  // so format differences don't slip through.
  const filledIsbnSet = useMemo(() => {
    const out = new Set<string>();
    for (const v of Object.values(values)) {
      const d = v.replace(/[^0-9Xx]/g, "");
      if (d) out.add(d);
    }
    return out;
  }, [values]);

  function startScanning() {
    // Resume at the first empty row so a partial typing session +
    // scan-the-rest workflow Just Works.
    const firstEmpty = books.findIndex(
      (b) => !(values[b.id] && values[b.id].trim()),
    );
    setScanIndex(firstEmpty === -1 ? books.length : firstEmpty);
    setLastFlash(null);
    setScanning(true);
  }

  function stopScanning() {
    setScanning(false);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setLastFlash(null);
  }

  function flashMessage(msg: string) {
    setLastFlash(msg);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setLastFlash(null), 1500);
  }

  function handleScan(code: string) {
    const digits = code.replace(/[^0-9Xx]/g, "");
    if (!digits) return;
    if (filledIsbnSet.has(digits)) {
      flashMessage(`Already filled: ${digits}`);
      return;
    }
    // Find the next row that's still empty starting from scanIndex.
    let target = scanIndex;
    while (
      target < books.length &&
      values[books[target].id] &&
      values[books[target].id].trim()
    ) {
      target++;
    }
    if (target >= books.length) {
      flashMessage("All rows filled — tap Done");
      return;
    }
    const book = books[target];
    setIsbn(book.id, digits);
    setScanIndex(target + 1);
    flashMessage(`Filled row ${target + 1}: ${truncate(book.title)}`);
  }

  function skipCurrentRow() {
    setScanIndex((i) => Math.min(i + 1, books.length));
    flashMessage(
      scanIndex + 1 <= books.length
        ? `Skipped row ${scanIndex + 1}`
        : "End of list",
    );
  }

  async function submit() {
    const updates = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([bookId, isbn]) => ({ bookId, isbn: isbn.trim() }));
    if (updates.length === 0) {
      toast.error("Type or scan at least one ISBN to submit.");
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

  const currentTarget = books[scanIndex] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={startScanning}
          disabled={busy || scanning}
        >
          <ScanBarcode className="size-4" />
          Scan barcodes
        </Button>
      </div>

      <div className="space-y-2">
        {books.map((book, idx) => (
          <Card
            key={book.id}
            className={`overflow-hidden ${
              scanning && idx === scanIndex ? "ring-primary/40 ring-2" : ""
            }`}
          >
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

      {scanning && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          {/* Header: progress + close */}
          <div className="flex items-center justify-between gap-3 p-3 text-white">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                Scanning · {filledCount} of {books.length} filled
              </p>
              {currentTarget && (
                <p className="text-white/70 truncate text-xs">
                  Next: {truncate(currentTarget.title)}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={stopScanning}
            >
              <X className="size-4" />
              Done
            </Button>
          </div>

          {/* Camera viewfinder */}
          <div className="relative flex-1 overflow-hidden">
            <BarcodeReader
              continuous
              className="h-full w-full object-cover"
              onScan={handleScan}
              onError={(message) => {
                toast.error(message);
                stopScanning();
              }}
            />
            {/* Center crosshair to help users aim */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-3/4 max-w-sm rounded-md border-2 border-white/60" />
            </div>
            {/* Flash banner */}
            {lastFlash && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1.5 text-xs text-white">
                {lastFlash}
              </div>
            )}
          </div>

          {/* Footer: skip + done */}
          <div className="flex gap-2 p-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={skipCurrentRow}
              disabled={scanIndex >= books.length}
            >
              Skip this row
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={stopScanning}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string | null, max = 40): string {
  if (!s) return "(no title)";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
