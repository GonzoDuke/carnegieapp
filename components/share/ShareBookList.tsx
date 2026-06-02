import { BookCover } from "@/components/BookCover";
import { Badge } from "@/components/ui/badge";

export type ShareBook = {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  status: "pending_review" | "confirmed" | "rejected";
};

type Props = {
  books: ShareBook[];
};

// Read-only book list for the public share view. A server component (no
// interactivity) that leans on the presentational BookCover client island
// for cover art + Open Library fallback. None of BooksList's edit / confirm
// / relookup affordances — colleagues only read.
export default function ShareBookList({ books }: Props) {
  if (books.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        No books in this cart yet.
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {books.map((book) => (
        <li key={book.id}>
          <div className="flex items-start gap-3 rounded-lg border p-3">
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
                <p className="font-medium leading-snug">{book.title}</p>
                {book.status === "pending_review" && (
                  <Badge variant="secondary" className="shrink-0">
                    under review
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {book.authors.length > 0
                  ? book.authors.join(" / ")
                  : "Unknown author"}
                {book.isbn13
                  ? ` · ${book.isbn13}`
                  : book.isbn10
                    ? ` · ${book.isbn10}`
                    : ""}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
