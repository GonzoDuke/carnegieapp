"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Book } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookCover } from "@/components/BookCover";

type Props = {
  batchId: string;
  books: Book[];
};

const EXPAND_PREF_KEY = "carnegie:books-expanded";

// useSyncExternalStore subscribe — fires the callback when the storage
// event fires (cross-tab updates) AND for our own writes via a manually
// dispatched event below. Returns a cleanup.
function subscribeToStoragePref(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getClientPref(): string | null {
  try {
    return localStorage.getItem(EXPAND_PREF_KEY);
  } catch {
    return null;
  }
}

function getServerPref(): string | null {
  return null;
}

function writePref(next: boolean) {
  try {
    localStorage.setItem(EXPAND_PREF_KEY, next ? "1" : "0");
    // The native `storage` event only fires in OTHER tabs. Dispatch
    // one ourselves so our useSyncExternalStore subscribers update.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* localStorage blocked — preference is still applied this session via
       direct setExpandAll fallback (handled at the call site) */
  }
}

export default function BooksList({ batchId, books }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // expand-all preference is derived directly from localStorage via
  // useSyncExternalStore — no effect needed for the read, no
  // setState-in-effect lint pain. "1" = expanded, "0" = collapsed,
  // null = no preference (the native <details> default takes over).
  const stored = useSyncExternalStore(
    subscribeToStoragePref,
    getClientPref,
    getServerPref,
  );
  const expandAll: boolean | null =
    stored === "1" ? true : stored === "0" ? false : null;
  const listRef = useRef<HTMLUListElement | null>(null);

  // Sync every <details> in the list to the current expandAll state.
  // Re-runs when the books array changes so newly-added rows pick up
  // the user's preference too. When expandAll is null (no preference)
  // we leave each <details> alone — the browser's default behavior
  // takes over.
  useEffect(() => {
    if (expandAll === null) return;
    const els = listRef.current?.querySelectorAll<HTMLDetailsElement>("details");
    els?.forEach((el) => {
      el.open = expandAll;
    });
  }, [expandAll, books]);

  function toggleExpandAll() {
    // expandAll could be null (no pref yet); first click goes to expanded.
    writePref(expandAll !== true);
  }

  // The state set may contain stale IDs after a router.refresh removed some
  // books — derive the live selection on each render rather than syncing
  // back to state (avoids cascading renders and a "set state in effect"
  // lint hit).
  const visibleIds = useMemo(() => books.map((b) => b.id), [books]);
  const validIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const liveSelection = useMemo(
    () => Array.from(selected).filter((id) => validIdSet.has(id)),
    [selected, validIdSet],
  );
  const selectionCount = liveSelection.length;
  const allSelected =
    visibleIds.length > 0 && selectionCount === visibleIds.length;
  const someSelected = !allSelected && selectionCount > 0;

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(visibleIds) : new Set());
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkAction(action: "confirm" | "delete") {
    if (selectionCount === 0 || bulkBusy) return;
    if (action === "delete") {
      const ok = window.confirm(
        `Delete ${selectionCount} ${selectionCount === 1 ? "book" : "books"}? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/books/bulk-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookIds: liveSelection,
          action,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `Failed (${res.status})`);
      }
      const verb = action === "confirm" ? "Confirmed" : "Deleted";
      toast.success(`${verb} ${json?.updated ?? 0} books`);
      clearSelection();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 space-y-2">
        <h2 className="font-heading text-lg font-semibold tracking-tight">
          Books
          <span className="text-muted-foreground ml-1.5 text-sm font-normal">
            ({books.length})
          </span>
        </h2>
        {books.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={(c) => toggleAll(c === true)}
                aria-label={allSelected ? "Deselect all" : "Select all"}
              />
              {allSelected ? "Deselect all" : "Select all"}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleExpandAll}
              className="text-muted-foreground hover:text-foreground"
              title={expandAll ? "Collapse every book card" : "Expand every book card"}
            >
              {expandAll ? (
                <>
                  <ChevronsDownUp className="size-3.5" />
                  Collapse all
                </>
              ) : (
                <>
                  <ChevronsUpDown className="size-3.5" />
                  Expand all
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      <ul ref={listRef} className="space-y-2">
        {books.map((book) => {
          const dot = confidenceDot(book.source, book.confidence);
          const isChecked = selected.has(book.id);
          return (
            <li
              key={book.id}
              id={`book-${book.id}`}
              className="scroll-mt-20"
            >
              <Card
                className={`overflow-hidden transition-all ${
                  isChecked
                    ? "border-primary/60 bg-primary/5 shadow-sm"
                    : "hover:border-primary/30 hover:shadow-sm"
                }`}
              >
                <div className="flex items-start gap-3 p-3 sm:p-4">
                  <label className="mt-0.5 flex shrink-0 cursor-pointer items-center">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(c) => toggle(book.id, c === true)}
                      aria-label={`Select ${book.title}`}
                    />
                  </label>
                  <BookCover
                    coverUrl={book.coverUrl}
                    isbn13={book.isbn13}
                    isbn10={book.isbn10}
                    title={book.title}
                    size="sm"
                    className="mt-0.5"
                  />
                  <details className="group min-w-0 flex-1">
                    <summary className="cursor-pointer list-none">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {dot && (
                            <span
                              className={`inline-block size-2 shrink-0 rounded-full ${dot}`}
                              aria-label={`confidence ${book.confidence?.toFixed(2)}`}
                            />
                          )}
                          <span className="min-w-0 truncate font-medium">
                            {book.title}
                          </span>
                          <ChevronRight className="text-muted-foreground ml-auto size-4 shrink-0 transition-transform group-open:rotate-90" />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-muted-foreground min-w-0 truncate text-xs">
                            {book.authors.length > 0
                              ? book.authors.join(" / ")
                              : "Unknown author"}
                            {book.isbn13 && ` · ${book.isbn13}`}
                            {book.isbn10 && !book.isbn13 && ` · ${book.isbn10}`}
                          </span>
                          <Badge
                            variant={statusBadgeVariant(book.status)}
                            className="shrink-0"
                          >
                            {book.status.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                    </summary>

                    {book.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
                          Tags
                        </span>
                        {book.tags.map((tag) => (
                          <form
                            key={tag}
                            method="POST"
                            action={`/api/batches/${batchId}/books/${book.id}`}
                            className="inline-flex"
                          >
                            <input type="hidden" name="_action" value="remove-tag" />
                            <input type="hidden" name="tag" value={tag} />
                            <button
                              type="submit"
                              title={`Remove tag "${tag}"`}
                              className="bg-secondary text-secondary-foreground hover:bg-destructive/10 hover:text-destructive group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors"
                            >
                              <span>{tag}</span>
                              <span className="text-muted-foreground group-hover:text-destructive">
                                ×
                              </span>
                            </button>
                          </form>
                        ))}
                      </div>
                    )}

                    {book.lcc && (
                      <div className="mt-2 flex items-center gap-2 text-[11px]">
                        <span className="text-muted-foreground font-medium uppercase tracking-wider">
                          LCC
                        </span>
                        <code className="bg-muted rounded px-2 py-0.5 font-mono">
                          {book.lcc}
                        </code>
                      </div>
                    )}

                    {book.description && (
                      <blockquote className="border-primary/30 bg-muted/40 text-muted-foreground mt-3 rounded-r border-l-2 px-3 py-2 text-xs italic leading-relaxed">
                        {book.description}
                      </blockquote>
                    )}

                    <form
                      method="POST"
                      action={`/api/batches/${batchId}/books/${book.id}`}
                      className="bg-muted/30 mt-3 space-y-3 rounded-md p-3"
                      onSubmit={(e) => {
                        // Native form-submit, server returns 303 redirect.
                        // We can't show a post-action toast (the page
                        // reloads, killing client state) — but we CAN show
                        // a loading toast that bridges the dead-zone while
                        // the lookup chain runs (5–25s in the worst case).
                        // The post-redirect Alert at the top of the batch
                        // page tells the user whether it hit or missed.
                        //
                        // Do NOT disable the submit button here — disabling
                        // it synchronously inside onSubmit cancels the form
                        // submission in some browsers (the button is
                        // "disabled" by the time the browser starts the
                        // POST, so the POST never fires). Toast alone is
                        // the visible feedback.
                        const submitter = (e.nativeEvent as SubmitEvent)
                          .submitter as HTMLButtonElement | null;
                        if (submitter?.value === "relookup") {
                          toast.loading("Re-running lookup chain…", {
                            id: `relookup-${book.id}`,
                            description: "Up to ~20 seconds.",
                          });
                        }
                      }}
                    >
                      <input type="hidden" name="_action" value="save" />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`title-${book.id}`}>Title</Label>
                          <Input
                            id={`title-${book.id}`}
                            type="text"
                            name="title"
                            defaultValue={book.title}
                            required
                            maxLength={1000}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`authors-${book.id}`}>Authors</Label>
                          <Input
                            id={`authors-${book.id}`}
                            type="text"
                            name="authors"
                            defaultValue={book.authors.join(", ")}
                            placeholder="Comma-separated authors"
                            maxLength={1000}
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`isbn-${book.id}`}>ISBN</Label>
                        <Input
                          id={`isbn-${book.id}`}
                          type="text"
                          name="isbn"
                          defaultValue={book.isbn13 ?? book.isbn10 ?? ""}
                          placeholder="ISBN-10 or ISBN-13 (hyphens OK)"
                          maxLength={20}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`publisher-${book.id}`}>Publisher</Label>
                          <Input
                            id={`publisher-${book.id}`}
                            type="text"
                            name="publisher"
                            defaultValue={book.publisher ?? ""}
                            maxLength={200}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`pubdate-${book.id}`}>Publication date</Label>
                          <Input
                            id={`pubdate-${book.id}`}
                            type="text"
                            name="pubDate"
                            defaultValue={book.pubDate ?? ""}
                            maxLength={100}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Button type="submit" variant="outline" size="sm">
                          Save edits
                        </Button>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          name="_action"
                          value="relookup"
                          title="Save edits and rerun the lookup chain"
                        >
                          <Sparkles className="size-3.5" />
                          Re-lookup
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          name="status"
                          value="confirmed"
                        >
                          Confirm
                        </Button>
                      </div>
                    </form>
                  </details>

                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-start">
                    {/* Inline confirm — only when not already confirmed.
                        Sits with the delete button to mirror the pattern. */}
                    {book.status !== "confirmed" && (
                      <form
                        method="POST"
                        action={`/api/batches/${batchId}/books/${book.id}`}
                      >
                        <input type="hidden" name="_action" value="save" />
                        <input type="hidden" name="status" value="confirmed" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon-sm"
                          title="Confirm this book"
                          className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        >
                          <Check className="size-4" />
                        </Button>
                      </form>
                    )}
                    <form
                      method="POST"
                      action={`/api/batches/${batchId}/books/${book.id}`}
                    >
                      <input type="hidden" name="_action" value="delete" />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        title="Delete this book"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {/* Sticky bulk-action bar — appears only when ≥1 row selected.
          Centered at the bottom of the viewport on mobile and desktop.
          Uses the same Card primitive + backdrop blur as the top bar so
          it feels native to the rest of the design. */}
      {selectionCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <Card className="bg-background/85 pointer-events-auto shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/65 animate-in slide-in-from-bottom-4 duration-200">
            <CardContent className="flex flex-wrap items-center gap-2 px-3 py-2">
              {/* Selection count only — the Select all checkbox lives
                  in the Books header now. Bulk bar's job is to show
                  what's selected and operate on it; the X button
                  clears the selection. */}
              <span className="text-foreground px-1 text-xs font-medium whitespace-nowrap">
                {selectionCount} of {visibleIds.length} selected
              </span>

              <div className="bg-border h-5 w-px" />

              <Button
                type="button"
                size="sm"
                onClick={() => bulkAction("confirm")}
                disabled={bulkBusy}
              >
                <CheckCheck className="size-4" />
                {bulkBusy ? "Working…" : "Confirm"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => bulkAction("delete")}
                disabled={bulkBusy}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={clearSelection}
                disabled={bulkBusy}
                title="Clear selection"
                className="text-muted-foreground"
              >
                <X className="size-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
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

function confidenceDot(
  source: "vision" | "barcode" | "manual",
  confidence: number | null,
): string | null {
  if (source !== "vision" || confidence === null) return null;
  if (confidence >= 0.85) return "bg-emerald-500";
  if (confidence >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}
