import type { LookupResult } from "./types.ts";
import { pickGoogleBooksCover } from "./googlebooks.ts";
import { cleanSubjectTags } from "./subjects.ts";
import { cleanDescription } from "./description.ts";
import { searchOpenLibraryByTitle } from "./openlibrary.ts";
import { searchIsbndbByTitle } from "./isbndb.ts";
import { lookupByIsbn } from "./index.ts";
import { isAcceptable } from "./types.ts";
import { authorsLikelyMatch } from "./match.ts";
import { normalizeIsbn } from "./isbn.ts";

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

  // Provider preference order: ISBNdb > GB > OL. Used both to pick a
  // candidate when providers agree and to fall back to title-only when
  // they don't.
  const ordered = [isbndbHit, gbHit, olHit];
  const acceptable = ordered.filter(
    (r): r is LookupResult => isAcceptable(r),
  );
  if (acceptable.length === 0) {
    // No usable hit at all. Return any non-null so the caller at least
    // gets a partial — same behavior as before.
    return ordered.find((r): r is LookupResult => !!r) ?? null;
  }

  // Author-overlap guardrail (applied early so we don't waste the
  // agreement check on a wrong-author hit). If the caller gave an
  // author hint and no acceptable hit shares a token with it, drop.
  const authorHint = author?.trim() ? [author] : null;
  if (authorHint) {
    const anyAuthorMatch = acceptable.some((h) =>
      authorsLikelyMatch(authorHint, h.authors),
    );
    if (!anyAuthorMatch) return null;
  }

  // Providers-must-agree gate. ISBN identifies a specific printing; a
  // title-only search can plausibly return *any* edition. To avoid
  // silently committing to the wrong edition, only commit an ISBN when
  // ≥2 providers returned the same one. If they disagree (or only one
  // returned an ISBN), we keep the best title+author+cover metadata but
  // null out the ISBN — the row lands in Quick-fill for the user to
  // supply the correct ISBN from the back cover.
  const agreedIsbn13 = findAgreedIsbn(acceptable);

  let candidate: LookupResult;
  if (agreedIsbn13) {
    // Pick the highest-priority provider that returned the agreed ISBN.
    candidate =
      acceptable.find((h) => sameIsbn13(h, agreedIsbn13)) ?? acceptable[0];
  } else {
    // No agreement — strip ISBN from whichever record we hand back. The
    // metadata is still useful; the ISBN would be a guess.
    candidate = { ...acceptable[0], isbn13: null, isbn10: null };
  }

  // Cascade only when we have an agreed ISBN — without one, there's
  // nothing reliable to cascade against.
  if (agreedIsbn13) {
    const outcome = await lookupByIsbn(agreedIsbn13);
    if (outcome.result) {
      return mergeFromCandidate(outcome.result, candidate);
    }
  }

  return candidate;
}

// Returns the ISBN-13 that 2+ providers agreed on, or null if no
// agreement exists. ISBN-10s are normalized to their 978-prefixed
// 13-form so a provider that returned the 10-form and another that
// returned the 13-form count as agreeing.
function findAgreedIsbn(hits: LookupResult[]): string | null {
  const counts = new Map<string, number>();
  for (const h of hits) {
    const key = canonicalIsbn13(h);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of counts) {
    if (n >= 2) return key;
  }
  return null;
}

function canonicalIsbn13(r: LookupResult): string | null {
  if (r.isbn13) {
    const stripped = r.isbn13.replace(/[^0-9]/g, "");
    if (stripped.length === 13) return stripped;
  }
  if (r.isbn10) {
    const norm = normalizeIsbn(r.isbn10);
    if (norm.isbn13) return norm.isbn13;
  }
  return null;
}

function sameIsbn13(r: LookupResult, isbn13: string): boolean {
  return canonicalIsbn13(r) === isbn13;
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
