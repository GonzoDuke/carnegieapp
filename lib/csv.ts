import { stringify } from "csv-stringify/sync";
import type { Batch, Book } from "@/lib/db/schema";

// LibraryThing's CSV import is column-flexible but matches these headers
// reliably. Authors are joined with " / " — that's LibraryThing's own
// convention for multi-author works. "Library of Congress Classification"
// is added on a best-effort basis: if LT's importer matches the header
// it lands in the dedicated LCC slot; if not, the column is ignored
// silently and the same value still appears in Comments as a safety net.
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

export function buildLibraryThingCsv(books: Book[], batch: CsvBatch): string {
  // Location goes into Comments — LibraryThing has no first-class field for
  // it and Comments is the right place for free-form context per book.
  const locationLine = batch.location ? `Location: ${batch.location}` : null;

  const rows = books.map((book) => {
    // LibraryThing prefers ISBN-13; fall back to ISBN-10 if that's all we have.
    const isbn = book.isbn13 || book.isbn10 || "";
    const author = book.authors.join(" / ");
    // Tags column carries only subject tags from the lookup chain (and any
    // user-added tags on the book row).
    const tags = book.tags.filter(Boolean).join(", ");
    // Collections column: batch name first, then any user-curated
    // collections on the book row. LibraryThing's importer creates the
    // named collection on first import — so books from a "Garage" batch
    // land in the "Garage" collection rather than getting dumped into
    // "Your library" by default. Deduped in case the user added the
    // batch name to book.collections by hand.
    const collectionList = [batch.name, ...book.collections.filter(Boolean)]
      .filter((c): c is string => Boolean(c))
      .filter((c, i, a) => a.indexOf(c) === i);
    const collections = collectionList.join(", ");
    // Comments: location, LCC call number, the synopsis captured at lookup
    // time, then any per-book user comment. Each on its own line so LT
    // renders them readably.
    const lccLine = book.lcc ? `LCC: ${book.lcc}` : null;
    const descriptionLine = book.description ? book.description : null;
    const comments = [
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
      "Library of Congress Classification": book.lcc ?? "",
      Comments: comments,
    };
  });

  return stringify(rows, {
    header: true,
    columns: LIBRARYTHING_COLUMNS.map((c) => ({ key: c, header: c })),
  });
}
