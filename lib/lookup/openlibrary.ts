import type { LookupResult } from "./types.ts";
import type { NormalizedIsbn } from "./isbn.ts";
import { cleanSubjectTags } from "./subjects.ts";
import { cleanDescription } from "./description.ts";

const BASE_URL = "https://openlibrary.org";
// 8s, up from 4s. Open Library's search.json and bibkeys endpoints have
// been consistently slow lately and were timing out on most requests at
// 4s. Bumping to 8s lets OL contribute its LCC values (the only provider
// that has them) more often. The chain still races OL in parallel with
// ISBNdb + GB, so this only matters when OL is the slow one.
const TIMEOUT_MS = 8000;

type OlBook = {
  title?: string;
  subtitle?: string;
  publish_date?: string;
  publishers?: { name: string }[];
  authors?: { url: string; name: string }[];
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
  cover?: { small?: string; medium?: string; large?: string };
  classifications?: {
    lc_classifications?: string[];
    dewey_decimal_class?: string[];
  };
  subjects?: Array<{ name?: string; url?: string } | string>;
  notes?: string | { value?: string; type?: string };
  excerpts?: Array<{ text?: string; comment?: string }>;
};

type OlEnvelope = Record<string, OlBook>;

// Look up via OL's bibkeys data API. Pre-2007 books are sometimes indexed
// only under ISBN-10; we send both forms in a single request so either match
// hits.
export async function lookupOpenLibrary(
  isbn: NormalizedIsbn,
): Promise<LookupResult | null> {
  const keys: string[] = [];
  if (isbn.isbn13) keys.push(`ISBN:${isbn.isbn13}`);
  if (isbn.isbn10) keys.push(`ISBN:${isbn.isbn10}`);
  if (keys.length === 0) return null;

  const url = `${BASE_URL}/api/books?bibkeys=${encodeURIComponent(
    keys.join(","),
  )}&format=json&jscmd=data`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/openlibrary] request failed:", err);
    return null;
  }

  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as OlEnvelope | null;
  if (!json) return null;

  // Prefer the ISBN-13 keyed result if both came back; either works.
  const book =
    (isbn.isbn13 && json[`ISBN:${isbn.isbn13}`]) ||
    (isbn.isbn10 && json[`ISBN:${isbn.isbn10}`]) ||
    null;
  if (!book) return null;

  return projectBookToResult(book, isbn);
}

// Open Library's search.json indexes a much broader set of works than the
// bibkeys data API exposes. Use as a last-resort fallback when bibkeys
// returns nothing.
export async function lookupOpenLibrarySearch(
  isbn: NormalizedIsbn,
): Promise<LookupResult | null> {
  const queryIsbn = isbn.isbn13 ?? isbn.isbn10;
  if (!queryIsbn) return null;

  // OL's search.json defaults to a minimal field set that does NOT include
  // lcc. Without &fields=...,lcc, the response is silently missing the
  // only metadata we're calling this endpoint for. Field list mirrors the
  // SearchDoc type below — extend both together.
  const url = `${BASE_URL}/search.json?isbn=${encodeURIComponent(queryIsbn)}&limit=1&fields=key,title,subtitle,author_name,publisher,publish_date,first_publish_year,isbn,cover_i,lcc`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/openlibrary-search] request failed:", err);
    return null;
  }

  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as SearchResponse | null;
  const doc = json?.docs?.[0];
  if (!doc) return null;
  return projectSearchDocToResult(doc, isbn.isbn13, isbn.isbn10);
}

// Title-and-author search against OL's search.json. Different index from
// the bibkeys data API; catches popular books that bibkeys misses.
// Returns null when the response shape is unusable; otherwise a LookupResult
// keyed off whatever ISBN the doc happens to expose.
export async function searchOpenLibraryByTitle(
  title: string,
  author: string | null,
): Promise<LookupResult | null> {
  if (!title.trim()) return null;

  const params = new URLSearchParams({ title, limit: "5" });
  if (author?.trim()) params.set("author", author.trim());
  // See note in lookupOpenLibrarySearch: fields=... is required to get lcc.
  params.set(
    "fields",
    "key,title,subtitle,author_name,publisher,publish_date,first_publish_year,isbn,cover_i,lcc",
  );
  const url = `${BASE_URL}/search.json?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/openlibrary-title] request failed:", err);
    return null;
  }
  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as SearchResponse | null;
  // Prefer the first doc that exposes any ISBN — those are the canonical
  // editions. Falls back to the first doc if none have one.
  const doc =
    json?.docs?.find((d) => Array.isArray(d.isbn) && d.isbn.length > 0) ??
    json?.docs?.[0];
  if (!doc) return null;
  return projectSearchDocToResult(doc, null, null);
}

type SearchDoc = {
  title?: string;
  subtitle?: string;
  author_name?: string[];
  publisher?: string[];
  publish_date?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  lcc?: string[];
};

type SearchResponse = { docs?: SearchDoc[] };

function projectSearchDocToResult(
  doc: SearchDoc,
  preferIsbn13: string | null,
  preferIsbn10: string | null,
): LookupResult | null {
  const title = [doc.title, doc.subtitle].filter(Boolean).join(": ").trim();
  if (!title) return null;
  const authors = (doc.author_name ?? []).map((a) => a.trim()).filter(Boolean);
  const publisher = doc.publisher?.[0]?.trim() || null;
  const pubDate =
    doc.publish_date?.[0]?.trim() ||
    (doc.first_publish_year ? String(doc.first_publish_year) : null);

  // Caller's known ISBN wins (when present); otherwise pick the first
  // recognizable ISBN-13 / ISBN-10 from the doc.
  const docIsbns = doc.isbn ?? [];
  const isbn13Out =
    preferIsbn13 ??
    docIsbns.find((s) => s.replace(/[^0-9X]/gi, "").length === 13) ??
    null;
  const isbn10Out =
    preferIsbn10 ??
    docIsbns.find((s) => s.replace(/[^0-9X]/gi, "").length === 10) ??
    null;

  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : null;

  return {
    source: "openlibrary",
    isbn13: isbn13Out,
    isbn10: isbn10Out,
    title,
    authors,
    publisher,
    pubDate,
    coverUrl,
    subjects: [],
    lcc: doc.lcc?.[0]?.trim() || null,
    description: null,
    raw: doc,
  };
}

function projectBookToResult(
  book: OlBook,
  isbn: NormalizedIsbn,
): LookupResult {
  const title = [book.title, book.subtitle].filter(Boolean).join(": ").trim();
  const authors = (book.authors ?? []).map((a) => a.name.trim()).filter(Boolean);
  const publisher = book.publishers?.[0]?.name?.trim() || null;
  const pubDate = book.publish_date?.trim() || null;
  const cover =
    book.cover?.medium || book.cover?.large || book.cover?.small || null;

  // OL subjects are too noisy by default (long MARC compound headings,
  // descriptive sentences, decade tags). We aggressively filter, then run
  // through the shared cleaner. Used as a fallback by the orchestrator —
  // ISBNdb / Google Books subjects are still preferred when present.
  const curatedSubjects = curateOlSubjects(book.subjects);

  // Description: bibkeys data view exposes "notes" as either a string or a
  // typed object; some books have an excerpt instead.
  const notesText =
    typeof book.notes === "string"
      ? book.notes
      : book.notes?.value || null;
  const excerptText = book.excerpts?.[0]?.text ?? null;
  const description = cleanDescription(notesText ?? excerptText);

  return {
    source: "openlibrary",
    isbn13: book.identifiers?.isbn_13?.[0] ?? isbn.isbn13 ?? null,
    isbn10: book.identifiers?.isbn_10?.[0] ?? isbn.isbn10 ?? null,
    title,
    authors,
    publisher,
    pubDate,
    coverUrl: cover ? cover.replace(/^http:/, "https:") : null,
    subjects: curatedSubjects,
    lcc: book.classifications?.lc_classifications?.[0]?.trim() || null,
    description,
    raw: book,
  };
}

// OL subjects are notoriously noisy. Strip out items that are clearly not
// useful library tags before handing to the shared cleaner. Cap at 3 (vs
// the global 5) so OL's quantity bias doesn't dominate.
function curateOlSubjects(
  raw: OlBook["subjects"] | undefined,
): string[] {
  if (!raw) return [];
  const candidates = raw
    .map((s) => (typeof s === "string" ? s : s?.name))
    .filter((s): s is string => !!s && typeof s === "string")
    // MARC subject heading subdivisions (e.g. "Pen pals -- Fiction").
    .filter((s) => !/--/.test(s))
    // Year and century tags.
    .filter((s) => !/^\s*\d{4}s?\s*$/.test(s))
    .filter((s) => !/^\s*\d{1,2}(st|nd|rd|th)\s+century\s*$/i.test(s))
    // Marketing / list noise.
    .filter((s) => !/best\s*sellers?/i.test(s))
    // Anything longer than 30 chars is almost always a descriptive sentence.
    .filter((s) => s.length <= 30)
    .slice(0, 3);
  return cleanSubjectTags(candidates);
}
