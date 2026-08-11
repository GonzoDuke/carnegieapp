"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Book } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BookCover } from "@/components/BookCover";

type Props = {
  batchId: string;
  books: Book[];
};

// What the per-book route answers with. Every action returns `ok` plus the
// action name; relookup adds its outcome so the caller can word the toast.
type BookActionResult = {
  ok?: boolean;
  error?: string;
  action?: string;
  outcome?: "hit" | "miss";
  source?: string | null;
  fieldsFilled?: string[];
};

const EXPAND_PREF_KEY = "carnegie:books-expanded";
const HIDE_CONFIRMED_PREF_KEY = "carnegie:books-hide-confirmed";

// useSyncExternalStore subscribe — fires the callback when the storage
// event fires (cross-tab updates) AND for our own writes via a manually
// dispatched event below. Returns a cleanup. Shared by every per-key
// reader below; the storage event doesn't say WHICH key changed, so
// all readers re-evaluate on any write, which is fine at this scale.
function subscribeToStoragePref(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getExpandAllPref(): string | null {
  try {
    return localStorage.getItem(EXPAND_PREF_KEY);
  } catch {
    return null;
  }
}

function getHideConfirmedPref(): string | null {
  try {
    return localStorage.getItem(HIDE_CONFIRMED_PREF_KEY);
  } catch {
    return null;
  }
}

function getServerPref(): string | null {
  return null;
}

function writeExpandAllPref(next: boolean) {
  writeStringPref(EXPAND_PREF_KEY, next ? "1" : "0");
}

function writeHideConfirmedPref(next: boolean) {
  writeStringPref(HIDE_CONFIRMED_PREF_KEY, next ? "1" : "0");
}

function writeStringPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    // The native `storage` event only fires in OTHER tabs. Dispatch
    // one ourselves so our useSyncExternalStore subscribers update.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* localStorage blocked — preference is applied only for this session */
  }
}

export default function BooksList({ batchId, books }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  // expand-all preference is derived directly from localStorage via
  // useSyncExternalStore — no effect needed for the read, no
  // setState-in-effect lint pain. "1" = expanded, "0" = collapsed,
  // null = no preference (the native <details> default takes over).
  const expandStored = useSyncExternalStore(
    subscribeToStoragePref,
    getExpandAllPref,
    getServerPref,
  );
  const expandAll: boolean | null =
    expandStored === "1" ? true : expandStored === "0" ? false : null;
  // hide-confirmed preference: when true, the books list filters out
  // status=confirmed rows so the user can focus on the review queue.
  // Default off ("0" / null both mean off).
  const hideConfirmedStored = useSyncExternalStore(
    subscribeToStoragePref,
    getHideConfirmedPref,
    getServerPref,
  );
  const hideConfirmed = hideConfirmedStored === "1";
  const listRef = useRef<HTMLUListElement | null>(null);

  // Books actually rendered — derived AFTER the hideConfirmed read.
  // Everything downstream (selection IDs, the expand-all effect, the
  // list render) keys off this filtered array so toggling the filter
  // re-derives consistently.
  const visibleBooks = useMemo(
    () =>
      hideConfirmed ? books.filter((b) => b.status !== "confirmed") : books,
    [books, hideConfirmed],
  );
  const hiddenConfirmedCount = hideConfirmed
    ? books.filter((b) => b.status === "confirmed").length
    : 0;

  // Sync every <details> in the list to the current expandAll state.
  // Re-runs when the visible books change so newly-added rows (and
  // rows that became visible after a filter toggle) pick up the
  // preference too.
  useEffect(() => {
    if (expandAll === null) return;
    const els = listRef.current?.querySelectorAll<HTMLDetailsElement>("details");
    els?.forEach((el) => {
      el.open = expandAll;
    });
  }, [expandAll, visibleBooks]);

  function toggleExpandAll() {
    // expandAll could be null (no pref yet); first click goes to expanded.
    writeExpandAllPref(expandAll !== true);
  }

  // The state set may contain stale IDs after a router.refresh removed some
  // books — derive the live selection on each render rather than syncing
  // back to state (avoids cascading renders and a "set state in effect"
  // lint hit). visibleIds is keyed off visibleBooks so confirmed rows
  // that get hidden by the filter drop out of the selection too.
  const visibleIds = useMemo(() => visibleBooks.map((b) => b.id), [visibleBooks]);
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

  // Per-row mutations. Same shape as bulkAction above — fetch, check res.ok,
  // toast, router.refresh() — but keyed per book so two rows can't collide
  // and only the acting row shows a pending state.
  //
  // These replaced five native <form> POSTs. Those submitted without
  // JavaScript, but every one reloaded the page and re-rendered the entire
  // batch — all books and all uploads, unpaginated — to change one row.
  async function bookAction(
    bookId: string,
    fields: Record<string, string>,
    messages: {
      pending?: string;
      success: string | ((json: BookActionResult) => string);
    },
  ): Promise<BookActionResult | null> {
    if (rowBusy.has(bookId)) return null;
    setRowBusy((prev) => new Set(prev).add(bookId));
    const toastId = messages.pending ? toast.loading(messages.pending) : undefined;
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.append(key, value);

      const res = await fetch(`/api/batches/${batchId}/books/${bookId}`, {
        method: "POST",
        body,
      });
      const json: BookActionResult | null = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `Failed (${res.status})`);
      }
      const text =
        typeof messages.success === "function"
          ? messages.success(json ?? {})
          : messages.success;
      toast.success(text, { id: toastId });
      router.refresh();
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (toastId) toast.error(message, { id: toastId });
      else toast.error(message);
      return null;
    } finally {
      setRowBusy((prev) => {
        const next = new Set(prev);
        next.delete(bookId);
        return next;
      });
    }
  }

  // The edit form keeps its <form> element — it's the right semantics for a
  // set of labelled fields, and it gives us Enter-to-submit for free. Only
  // the submission is intercepted.
  async function onEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;

    // Passing the submitter is load-bearing: it's what carries the clicked
    // button's own name/value (_action=relookup, status=confirmed). Without
    // it every button would submit an identical plain save.
    const data = new FormData(form, submitter ?? undefined);
    const fields: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      if (typeof value === "string") fields[key] = value;
    }
    // Duplicate keys collapse to the last value, which matches how the route
    // resolves a hidden _action against the clicked button's _action.
    const bookId = form.dataset.bookId!;

    if (fields._action === "relookup") {
      await bookAction(bookId, fields, {
        pending: "Re-running lookup chain…",
        success: (json) =>
          json.outcome === "hit"
            ? `Lookup refreshed${json.source ? ` from ${json.source}` : ""}${
                json.fieldsFilled?.length
                  ? ` · filled ${json.fieldsFilled.length} field${json.fieldsFilled.length === 1 ? "" : "s"}`
                  : " · nothing new to fill"
              }`
            : "No match found. Your edits were saved.",
      });
      return;
    }

    await bookAction(bookId, fields, {
      success: fields.status === "confirmed" ? "Confirmed" : "Saved",
    });
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
            {/* Hide confirmed — focus the list on the review queue.
                Preference persists via localStorage so the next visit
                remembers the user's choice. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => writeHideConfirmedPref(!hideConfirmed)}
              className="text-muted-foreground hover:text-foreground"
              title={
                hideConfirmed
                  ? "Show confirmed books too"
                  : "Hide confirmed books from this list"
              }
            >
              {hideConfirmed ? (
                <>
                  <Eye className="size-3.5" />
                  Show confirmed
                </>
              ) : (
                <>
                  <EyeOff className="size-3.5" />
                  Hide confirmed
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      {visibleBooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            All confirmed — {hiddenConfirmedCount}{" "}
            {hiddenConfirmedCount === 1 ? "book" : "books"} hidden by the filter.{" "}
            <button
              type="button"
              onClick={() => writeHideConfirmedPref(false)}
              className="text-foreground underline-offset-2 hover:underline"
            >
              Show all
            </button>
            .
          </CardContent>
        </Card>
      ) : null}
      <ul ref={listRef} className="space-y-2">
        {visibleBooks.map((book) => {
          const dot = confidenceDot(book.source, book.confidence);
          const isChecked = selected.has(book.id);
          const isBusy = rowBusy.has(book.id);
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
                } ${isBusy ? "opacity-60" : ""}`}
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
                          {/* Call number in the collapsed row: it's the
                              shelf address, so it should be scannable
                              down a list without expanding every card. */}
                          {book.lcc && (
                            <code className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.7rem]">
                              {book.lcc}
                            </code>
                          )}
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
                        <span className="text-muted-foreground text-[0.7rem] font-medium uppercase tracking-wider">
                          Tags
                        </span>
                        {book.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              bookAction(
                                book.id,
                                { _action: "remove-tag", tag },
                                { success: `Removed tag "${tag}"` },
                              )
                            }
                            title={`Remove tag "${tag}"`}
                            className="bg-secondary text-secondary-foreground hover:bg-destructive/10 hover:text-destructive group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            <span>{tag}</span>
                            <span className="text-muted-foreground group-hover:text-destructive">
                              ×
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {book.description && (
                      <blockquote className="border-primary/30 bg-muted/40 text-muted-foreground mt-3 rounded-r border-l-2 px-3 py-2 text-xs italic leading-relaxed">
                        {book.description}
                      </blockquote>
                    )}

                    {/* Still a <form>: correct semantics for a set of
                        labelled fields, and Enter-to-submit for free. Only
                        the submission is intercepted — see onEditSubmit,
                        which reads the clicked button out of the event so
                        Save / Re-lookup / Confirm stay distinguishable. */}
                    <form
                      data-book-id={book.id}
                      onSubmit={onEditSubmit}
                      className="bg-muted/30 mt-3 space-y-3 rounded-md p-3"
                    >
                      <input type="hidden" name="_action" value="save" />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`title-${book.id}`}>Title</Label>
                          {/* Textarea, not Input: a long title overflows a
                              single-line field on a phone, hiding the end of
                              the text where typos often hide. The textarea
                              wraps and auto-grows (field-sizing-content) so the
                              whole title stays visible and editable. Enter is
                              suppressed to keep single-line title semantics —
                              the wrapping is purely for display. */}
                          <Textarea
                            id={`title-${book.id}`}
                            name="title"
                            defaultValue={book.title}
                            required
                            maxLength={1000}
                            rows={2}
                            className="min-h-8 resize-y"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.preventDefault();
                            }}
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
                          inputMode="numeric"
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
                      {/* Call number. The lookup chain fills this when a
                          provider has it, but it misses often enough — and
                          disagrees with the sticker on the spine often
                          enough — that it has to be correctable by hand.
                          Re-lookup only fills empty fields, so a value you
                          type here survives. */}
                      <div className="grid gap-2">
                        <Label htmlFor={`lcc-${book.id}`}>
                          Call number
                          <span className="text-muted-foreground ml-1 font-normal">
                            (LCC)
                          </span>
                        </Label>
                        <Input
                          id={`lcc-${book.id}`}
                          type="text"
                          name="lcc"
                          defaultValue={book.lcc ?? ""}
                          placeholder="e.g. PR6045.O72 H37 1999"
                          maxLength={100}
                          className="font-mono"
                        />
                        {spineSticker(book) && (
                          <p className="text-muted-foreground text-xs">
                            Read off the spine:{" "}
                            <code className="bg-muted rounded px-1.5 py-0.5 font-mono">
                              {spineSticker(book)}
                            </code>{" "}
                            — not an LC call number, so it wasn&apos;t filled
                            in automatically.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                        >
                          Save edits
                        </Button>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          name="_action"
                          value="relookup"
                          disabled={isBusy}
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
                          disabled={isBusy}
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={isBusy}
                        onClick={() =>
                          bookAction(
                            book.id,
                            { _action: "save", status: "confirmed" },
                            { success: "Confirmed" },
                          )
                        }
                        title="Confirm this book"
                        className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Check className="size-4" />
                      </Button>
                    )}
                    {/* Un-confirm — mirrors the inline confirm but only
                        appears on already-confirmed rows. Flips status
                        back to pending_review so the row re-enters the
                        review queue. */}
                    {book.status === "confirmed" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={isBusy}
                        onClick={() =>
                          bookAction(
                            book.id,
                            { _action: "save", status: "pending_review" },
                            { success: "Back to pending review" },
                          )
                        }
                        title="Back to pending review"
                        className="text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Undo2 className="size-4" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={isBusy}
                      onClick={() =>
                        bookAction(
                          book.id,
                          { _action: "delete" },
                          { success: `Moved "${book.title}" to Trash` },
                        )
                      }
                      title="Delete this book"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
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

// The raw shelf sticker vision read off the spine, surfaced only when it
// didn't make it into the call-number field. `extractLcc` accepts LC-shaped
// strings and nothing else, so a Dewey number ("813.54 STE") or a genre
// label ("FIC TOL") gets stripped out of the title and then dropped. That's
// real information about where the book sits, and for a collection that
// isn't LC-classified it may be the only classification there is — so show
// it and let the user decide whether to keep it.
function spineSticker(book: Book): string | null {
  if (book.lcc) return null;
  const raw = book.rawVision;
  if (!raw || typeof raw !== "object") return null;
  const vision = (raw as { vision?: unknown }).vision;
  if (!vision || typeof vision !== "object") return null;
  const sticker = (vision as { spine_classification?: unknown })
    .spine_classification;
  return typeof sticker === "string" && sticker.trim() ? sticker.trim() : null;
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
