import { stringify } from "csv-stringify/sync";
import type { Batch, Book } from "@/lib/db/schema";

// LibraryThing's CSV import is column-flexible but matches these headers
// reliably. Authors are joined with " / " — that's LibraryThing's own
// convention for multi-author works.
export const LIBRARYTHING_COLUMNS = [
  "ISBN",
  "Title",
  "Author",
  "Publisher",
  "Date",
  "Tags",
  "Collections",
  "Comments",
] as const;

type CsvBatch = Pick<Batch, "name" | "location">;

export function buildLibraryThingCsv(books: Book[], batch: CsvBatch): string {
  // Batch name + location go into Comments rather than Tags so LibraryThing's
  // tag pool stays clean — only true subject tags ("fiction", "mystery", etc.)
  // make it into Tags.
  const batchLine = batch.name ? `Batch: ${batch.name}` : null;
  const locationLine = batch.location ? `Location: ${batch.location}` : null;

  const rows = books.map((book) => {
    // LibraryThing prefers ISBN-13; fall back to ISBN-10 if that's all we have.
    const isbn = book.isbn13 || book.isbn10 || "";
    const author = book.authors.join(" / ");
    // Tags column carries only subject tags from the lookup chain (and any
    // user-added tags on the book row).
    const tags = book.tags.filter(Boolean).join(", ");
    const collections = book.collections.join(", ");
    // Comments: batch context, location, LCC call number, the synopsis
    // captured at lookup time, then any per-book user comment. Each on its
    // own line so LT renders them readably.
    const lccLine = book.lcc ? `LCC: ${book.lcc}` : null;
    const descriptionLine = book.description ? book.description : null;
    const comments = [
      batchLine,
      locationLine,
      lccLine,
      descriptionLine,
      book.comments,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      ISBN: isbn,
      Title: book.title,
      Author: author,
      Publisher: book.publisher ?? "",
      Date: book.pubDate ?? "",
      Tags: tags,
      Collections: collections,
      Comments: comments,
    };
  });

  return stringify(rows, {
    header: true,
    columns: LIBRARYTHING_COLUMNS.map((c) => ({ key: c, header: c })),
  });
}
