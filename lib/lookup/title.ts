import type { LookupResult } from "./types.ts";
import { pickGoogleBooksCover } from "./googlebooks.ts";
import { cleanSubjectTags } from "./subjects.ts";
import { cleanDescription } from "./description.ts";
import { searchOpenLibraryByTitle } from "./openlibrary.ts";
import { searchIsbndbByTitle } from "./isbndb.ts";
import { lookupByIsbn } from "./index.ts";
import { isAcceptable } from "./types.ts";
import { authorsLikelyMatch } from "./match.ts";

// Title+author search lookup. Spine photos almost never expose an ISBN
// directly, so this is the main path that turns Claude's vision-extracted
// title/author into canonical metadata.
//
// Strategy:
//   1. Run Google Books and Open Library title searches in parallel.
//      Both have very different long tails — between them they catch
//      almost any in-print title.
//   2. Pick the first acceptable result (title + author present).
//   3. If that result exposes an ISBN, cascade to the full ISBN lookup
//      chain so we get the same enrichment (LCC, description, multi-source
//      covers) that scanned barcodes get.

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";
const TIMEOUT_MS = 4000;

type Identifier = { type: string; identifier: string };

type GbVolumeInfo = {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  industryIdentifiers?: Identifier[];
  categories?: string[];
  description?: string;
  imageLinks?: {
    smallThumbnail?: string;
    thumbnail?: string;
    small?: string;
    medium?: string;
    large?: string;
    extraLarge?: string;
  };
};

type GbVolume = { volumeInfo?: GbVolumeInfo };
type GbResponse = { items?: GbVolume[] };

export async function lookupByTitle(
  title: string,
  author: string | null,
): Promise<LookupResult | null> {
  if (!title.trim()) return null;

  // Three title-search providers race in parallel. Each has a different
  // long tail; together they catch nearly any in-print book.
  const [isbndbHit, gbHit, olHit] = await Promise.all([
    searchIsbndbByTitle(title, author),
    searchGoogleBooksByTitle(title, author),
    searchOpenLibraryByTitle(title, author),
  ]);

  // Prefer the first acceptable hit that has an ISBN to cascade through.
  // ISBNdb is preferred (paid + canonical), then GB, then OL.
  const ordered = [isbndbHit, gbHit, olHit];
  const acceptable = ordered.filter(
    (r): r is LookupResult => isAcceptable(r),
  );
  const withIsbn = acceptable.find((h) => h.isbn13 || h.isbn10);
  const candidate =
    withIsbn ??
    acceptable[0] ??
    ordered.find((r): r is LookupResult => !!r) ??
    null;
  if (!candidate) return null;

  // Author-overlap guardrail. A generic title ("America", "The Magicians",
  // "Reality+") can title-search to a completely different book with a
  // completely different author. If the caller gave us an author hint and
  // the candidate's authors share no token with it, treat as a miss
  // rather than ship the wrong book downstream.
  if (author && author.trim() && !authorsLikelyMatch([author], candidate.authors)) {
    return null;
  }

  // Cascade: when we have an ISBN, run the full multi-provider chain so we
  // get LCC, descriptions borrowed across providers, multi-source covers,
  // and the OL search.json LCC-recovery path — same enrichment a scanned
  // barcode would get. Then merge in any candidate fields the cascade
  // didn't fill (some providers don't expose covers/publishers in their
  // ISBN response but their title-search response did).
  const candidateIsbn = candidate.isbn13 ?? candidate.isbn10;
  if (candidateIsbn) {
    const outcome = await lookupByIsbn(candidateIsbn);
    if (outcome.result) {
      return mergeFromCandidate(outcome.result, candidate);
    }
  }

  // No usable ISBN to cascade — return the title-search hit as-is.
  return candidate;
}

const MAX_MERGED_SUBJECTS = 5;

// Fill nulls in the cascade result from the original title-search candidate.
// Title/author/ISBN stay canonical (cascade wins); peripheral fields like
// cover / publisher / lcc are taken from whichever source had them.
function mergeFromCandidate(
  cascade: LookupResult,
  candidate: LookupResult,
): LookupResult {
  return {
    ...cascade,
    publisher: cascade.publisher ?? candidate.publisher,
    pubDate: cascade.pubDate ?? candidate.pubDate,
    coverUrl: cascade.coverUrl ?? candidate.coverUrl,
    lcc: cascade.lcc ?? candidate.lcc,
    description: cascade.description ?? candidate.description,
    subjects: dedupeUnion(cascade.subjects, candidate.subjects),
  };
}

function dedupeUnion(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...a, ...b]) {
    const k = tag.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
    if (out.length >= MAX_MERGED_SUBJECTS) break;
  }
  return out;
}

async function searchGoogleBooksByTitle(
  title: string,
  author: string | null,
): Promise<LookupResult | null> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  // Loose match: no quotes around terms. GB tokenizes the query and matches
  // any record whose title/author fields contain those terms — way more
  // forgiving of small extraction differences (case, partial author, etc.)
  // than `intitle:"…"` strict-phrase matching.
  const parts = [`intitle:${title.trim()}`];
  if (author?.trim()) parts.push(`inauthor:${author.trim()}`);
  const params = new URLSearchParams({
    q: parts.join(" "),
    // Pull a handful of candidates so we can prefer the one that has an
    // ISBN — the first hit is sometimes a critical-essays companion volume
    // that lacks an ISBN.
    maxResults: "5",
  });
  if (apiKey) params.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/title-gb] request failed:", err);
    return null;
  }

  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as GbResponse | null;
  const items = json?.items ?? [];

  // Prefer the first volume that has industry identifiers (real ISBN data)
  // over decorative companion-style entries.
  const volume =
    items.find(
      (i) => (i.volumeInfo?.industryIdentifiers?.length ?? 0) > 0,
    ) ?? items[0];
  const info = volume?.volumeInfo;
  if (!info) return null;

  const matchTitle = [info.title, info.subtitle].filter(Boolean).join(": ").trim();
  const authors = (info.authors ?? []).map((a) => a.trim()).filter(Boolean);
  const ids = info.industryIdentifiers ?? [];

  return {
    source: "googlebooks",
    isbn13: ids.find((i) => i.type === "ISBN_13")?.identifier ?? null,
    isbn10: ids.find((i) => i.type === "ISBN_10")?.identifier ?? null,
    title: matchTitle,
    authors,
    publisher: info.publisher?.trim() || null,
    pubDate: info.publishedDate?.trim() || null,
    coverUrl: pickGoogleBooksCover(info.imageLinks),
    subjects: cleanSubjectTags(info.categories),
    lcc: null,
    description: cleanDescription(info.description),
    raw: info,
  };
}
