import type { LookupResult } from "./types";
import { cleanSubjectTags } from "./subjects";
import { cleanDescription } from "./description";

const BASE_URL = "https://api2.isbndb.com";
const TIMEOUT_MS = 4000;

type IsbndbBook = {
  isbn?: string;
  isbn13?: string;
  title?: string;
  title_long?: string;
  authors?: string[];
  publisher?: string;
  date_published?: string;
  image?: string;
  subjects?: string[];
  // ISBNdb actually ships their misspelling on the field name.
  synopsys?: string;
  // Newer responses have the corrected spelling too — accept either.
  synopsis?: string;
};

export async function lookupIsbndb(isbn13: string): Promise<LookupResult | null> {
  const apiKey = process.env.ISBNDB_API_KEY;
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/book/${encodeURIComponent(isbn13)}`, {
      headers: { Authorization: apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/isbndb] request failed:", err);
    return null;
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn("[lookup/isbndb] non-OK status:", response.status);
    return null;
  }

  const json = (await response.json().catch(() => null)) as
    | { book?: IsbndbBook }
    | null;
  const book = json?.book;
  if (!book) return null;

  return projectIsbndbBook(book, isbn13);
}

// ISBNdb's title-search endpoint (`/books/{query}`). Used as a third
// title-search provider alongside Google Books and Open Library — finds
// well-known titles that GB indexes loosely or that OL hasn't surfaced.
// Returns the first book in the result list that has an ISBN we can
// cascade through; returns null if no API key, no results, or no usable
// entry.
export async function searchIsbndbByTitle(
  title: string,
  author: string | null,
): Promise<LookupResult | null> {
  const apiKey = process.env.ISBNDB_API_KEY;
  if (!apiKey || !title.trim()) return null;

  const params = new URLSearchParams({ pageSize: "5" });
  if (author?.trim()) params.set("author", author.trim());
  const url = `${BASE_URL}/books/${encodeURIComponent(title.trim())}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/isbndb-title] request failed:", err);
    return null;
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn("[lookup/isbndb-title] non-OK status:", response.status);
    return null;
  }

  const json = (await response.json().catch(() => null)) as
    | { books?: IsbndbBook[]; total?: number }
    | null;
  const books = json?.books ?? [];
  // Prefer the first entry that has an actual ISBN — title-search results
  // sometimes include print-on-demand companion entries with no ISBN.
  const book =
    books.find((b) => b.isbn13 || b.isbn) ?? books[0] ?? null;
  if (!book) return null;

  return projectIsbndbBook(book, null);
}

function projectIsbndbBook(
  book: IsbndbBook,
  fallbackIsbn13: string | null,
): LookupResult {
  const title = (book.title_long || book.title || "").trim();
  const authors = (book.authors ?? []).map((a) => a.trim()).filter(Boolean);

  return {
    source: "isbndb",
    isbn13: book.isbn13 ?? fallbackIsbn13,
    isbn10: book.isbn ?? null,
    title,
    authors,
    publisher: book.publisher?.trim() || null,
    pubDate: book.date_published?.trim() || null,
    coverUrl: secureUrl(book.image),
    subjects: cleanSubjectTags(book.subjects),
    lcc: null,
    description: cleanDescription(book.synopsys ?? book.synopsis),
    raw: book,
  };
}

function secureUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.replace(/^http:/, "https:");
}
