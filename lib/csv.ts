import { stringify } from "csv-stringify/sync";
import type { Batch, Book } from "@/lib/db/schema";

// LibraryThing's CSV import is column-flexible but matches these headers
// reliably. Authors are joined with " / " — that's LibraryThing's own
// convention for multi-author works. LCC is its own dedicated column,
// not duplicated into Comments.
export const LIBRARYTHING_COLUMNS = [
  "ISBN",
  "Title",
  "Author",
  "Publisher",
  "Date",
  "Tags",
  "Collections",
  "Library of Congress Classification",
  "Comments",
] as const;

type CsvBatch = Pick<Batch, "name" | "location">;

// Filesystem-safe slug for a batch name, used to build download filenames
// (both the CSV export and the whole-batch ZIP). Lowercased, non-alnum runs
// collapsed to hyphens, trimmed, capped, with a fallback so empty/symbol-only
// names still produce a usable name.
export function batchSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "batch"
  );
}

// One book → one LibraryThing row, given its batch for context. Shared by the
// per-cart export and the cross-cart master list so both stay identical.
function libraryThingRow(book: Book, batch: CsvBatch) {
  // LibraryThing prefers ISBN-13; fall back to ISBN-10 if that's all we have.
  const isbn = book.isbn13 || book.isbn10 || "";
  const author = book.authors.join(" / ");
  // Tags column carries only subject tags from the lookup chain (and any
  // user-added tags on the book row).
  const tags = book.tags.filter(Boolean).join(", ");
  // Collections column: batch name first, then any user-curated collections
  // on the book row. LibraryThing's importer creates the named collection on
  // first import — so books from a "Garage" batch land in the "Garage"
  // collection rather than getting dumped into "Your library" by default.
  // Deduped in case the user added the batch name to book.collections by hand.
  const collectionList = [batch.name, ...book.collections.filter(Boolean)]
    .filter((c): c is string => Boolean(c))
    .filter((c, i, a) => a.indexOf(c) === i);
  const collections = collectionList.join(", ");
  // Comments: location, the synopsis captured at lookup time, then any
  // per-book user comment. Each on its own line so LT renders them readably.
  // LCC is NOT here — it lives in its own column.
  const locationLine = batch.location ? `Location: ${batch.location}` : null;
  const descriptionLine = book.description ? book.description : null;
  const comments = [locationLine, descriptionLine, book.comments]
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
    "Library of Congress Classification": book.lcc ?? "",
    Comments: comments,
  };
}

export function buildLibraryThingCsv(books: Book[], batch: CsvBatch): string {
  const rows = books.map((book) => libraryThingRow(book, batch));
  return stringify(rows, {
    header: true,
    columns: LIBRARYTHING_COLUMNS.map((c) => ({ key: c, header: c })),
  });
}

// Master-list columns: the LibraryThing set with a leading "Cart" so the
// combined sheet stays sortable/filterable by cart in Excel.
export const MASTER_COLUMNS = ["Cart", ...LIBRARYTHING_COLUMNS] as const;

// One CSV across many carts — every book from every cart in a single sheet.
// Each row keeps its cart's name up front (and, as before, in Collections),
// so nothing about the per-cart LibraryThing format changes downstream.
export function buildMasterCsv(
  items: { book: Book; batch: CsvBatch }[],
): string {
  const rows = items.map(({ book, batch }) => ({
    Cart: batch.name,
    ...libraryThingRow(book, batch),
  }));
  return stringify(rows, {
    header: true,
    columns: MASTER_COLUMNS.map((c) => ({ key: c, header: c })),
  });
}
