import { normalizeIsbn, type NormalizedIsbn } from "./isbn";
import { lookupIsbndb } from "./isbndb";
import { lookupOpenLibrary, lookupOpenLibrarySearch } from "./openlibrary";
import { lookupGoogleBooks } from "./googlebooks";
import { isAcceptable, type LookupResult, type LookupSource } from "./types";

export type { LookupResult, LookupSource } from "./types";
export { normalizeIsbn } from "./isbn";

export type LookupAttempt = {
  source: LookupSource;
  result: LookupResult | null;
  error?: string;
};

export type LookupOutcome = {
  isbn: NormalizedIsbn;
  result: LookupResult | null;
  attempts: LookupAttempt[];
};

async function runProvider(
  source: LookupSource,
  fn: () => Promise<LookupResult | null>,
): Promise<LookupAttempt> {
  try {
    return { source, result: await fn() };
  } catch (err) {
    return {
      source,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function lookupByIsbn(rawIsbn: string): Promise<LookupOutcome> {
  const isbn = normalizeIsbn(rawIsbn);
  const isbn13 = isbn.isbn13;
  if (!isbn13) {
    return { isbn, result: null, attempts: [] };
  }

  // All three providers race in parallel. ISBNdb is paid + most reliable so
  // its result is preferred when acceptable; OL is preferred over GB.
  // Open Library gets both ISBN forms in a single request — pre-2007 books
  // are sometimes only indexed under ISBN-10.
  const [isbndb, openlibrary, googlebooks] = await Promise.all([
    runProvider("isbndb", () => lookupIsbndb(isbn13)),
    runProvider("openlibrary", () => lookupOpenLibrary(isbn)),
    runProvider("googlebooks", () => lookupGoogleBooks(isbn13)),
  ]);

  const attempts: LookupAttempt[] = [isbndb, openlibrary, googlebooks];

  // Preference order: ISBNdb → OL → GB. First acceptable wins.
  let winner: LookupResult | null = null;
  for (const attempt of attempts) {
    if (isAcceptable(attempt.result)) {
      winner = attempt.result;
      break;
    }
  }

  // Last-resort fallback: OL's full-text search.json index. Broader than the
  // bibkeys data API. Single extra request, only when nothing else hit OR
  // when the winner is missing LCC (search.json is the only place outside OL
  // bibkeys that exposes LCC).
  if (!winner || !winner.lcc) {
    const olSearch = await runProvider("openlibrary", () =>
      lookupOpenLibrarySearch(isbn),
    );
    attempts.push(olSearch);
    if (!winner && isAcceptable(olSearch.result)) {
      winner = olSearch.result;
    }
  }

  // Last resort: take any partial result with at least a title.
  if (!winner) {
    winner = attempts.find((a) => a.result?.title)?.result ?? null;
  }

  return {
    isbn,
    result: winner ? enrichResult(winner, attempts) : null,
    attempts,
  };
}

// Borrow useful fields from non-winning attempts onto the winner. Keeps the
// orchestrator's preference order intact for the canonical title/author
// match while letting LCC, descriptions, and (curated) OL subjects fill
// in gaps.
function enrichResult(
  result: LookupResult,
  attempts: LookupAttempt[],
): LookupResult {
  const next = { ...result };

  // LCC: only OL exposes it. If winner doesn't have one, borrow.
  if (!next.lcc) {
    const fromOther = attempts.find((a) => a.result?.lcc)?.result?.lcc ?? null;
    if (fromOther) next.lcc = fromOther;
  }

  // Description: prefer Google Books (richest synopsis text), then ISBNdb,
  // then anything else. Only borrow if winner has none.
  if (!next.description) {
    const preferenceOrder: LookupSource[] = ["googlebooks", "isbndb", "openlibrary"];
    for (const src of preferenceOrder) {
      const found = attempts
        .filter((a) => a.source === src)
        .map((a) => a.result?.description)
        .find((d) => !!d);
      if (found) {
        next.description = found;
        break;
      }
    }
  }

  // Subjects: if winner has none, borrow from any other provider that does.
  // OL's curated subjects are the most likely fallback here since ISBNdb /
  // Google Books either had subjects (and would've been the winner's source)
  // or genuinely don't categorize this book.
  if (next.subjects.length === 0) {
    const fromOther = attempts.find(
      (a) => a.result && a.result.subjects.length > 0,
    )?.result?.subjects;
    if (fromOther && fromOther.length > 0) {
      next.subjects = fromOther;
    }
  }

  // Cover: if the winner picked the title-and-author fight but didn't ship a
  // cover image, borrow one. Google Books usually has the sharpest thumbnails;
  // OL is hit-or-miss; ISBNdb varies. Without this, ISBNdb-won books with no
  // image leave coverUrl null even when GB or OL had a perfectly good cover.
  if (!next.coverUrl) {
    const preferenceOrder: LookupSource[] = ["googlebooks", "openlibrary", "isbndb"];
    for (const src of preferenceOrder) {
      const found = attempts
        .filter((a) => a.source === src)
        .map((a) => a.result?.coverUrl)
        .find((c) => !!c);
      if (found) {
        next.coverUrl = found;
        break;
      }
    }
  }

  return next;
}
