"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import ShareBookList, { type ShareBook } from "@/components/share/ShareBookList";

type Props = {
  books: ShareBook[];
};

type Sort = "default" | "az" | "za";

// Client-side search + title sort over a cart's book list. A cart is ~125
// books, so filtering in the browser is instant and avoids server round-trips
// or URL state — the public page stays a single render. "default" keeps the
// server's shelf order (vision position, then creation time).
export default function ShareBooksPanel({ books }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("default");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = books;
    if (q) {
      // Strip separators so a typed ISBN matches regardless of hyphenation.
      const qDigits = q.replace(/[\s-]/g, "");
      out = books.filter((b) => {
        if (b.title.toLowerCase().includes(q)) return true;
        if (b.authors.some((a) => a.toLowerCase().includes(q))) return true;
        if (qDigits) {
          const isbn = `${b.isbn13 ?? ""}${b.isbn10 ?? ""}`;
          if (isbn.includes(qDigits)) return true;
        }
        return false;
      });
    }
    if (sort !== "default") {
      out = [...out].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
      if (sort === "za") out.reverse();
    }
    return out;
  }, [books, query, sort]);

  const searching = query.trim().length > 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Books
          <span className="text-muted-foreground ml-1.5 text-sm font-normal">
            ({searching ? `${visible.length} of ${books.length}` : books.length})
          </span>
        </h2>
      </div>

      {books.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, author, or ISBN"
              aria-label="Search books in this cart"
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border pl-8 pr-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort books"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none sm:w-44"
          >
            <option value="default">Shelf order</option>
            <option value="az">Title A–Z</option>
            <option value="za">Title Z–A</option>
          </select>
        </div>
      )}

      {books.length === 0 ? (
        <ShareBookList books={books} />
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No books match “{query.trim()}”.
        </p>
      ) : (
        <ShareBookList books={visible} />
      )}
    </section>
  );
}
