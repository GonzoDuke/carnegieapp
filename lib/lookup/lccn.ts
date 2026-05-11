// LCCN (Library of Congress Control Number) lookup. Only Open Library's
// bibkeys data API supports LCCN — ISBNdb and Google Books don't index by
// it. This is the right key for older books that predate ISBN, which is
// the user's actual use case (an LCCN-only entry in the Manual tab).
//
// Format reference: LCCNs are typically 8–12 chars, optionally with a
// 1–3 letter prefix (e.g. "n", "sh", "no") and sometimes hyphens. We
// normalize by stripping non-alphanumeric chars before sending — the OL
// API is forgiving but cleaner input gets cleaner cache hits.
import type { LookupResult } from "./types.ts";
import { cleanSubjectTags } from "./subjects.ts";
import { cleanDescription } from "./description.ts";

const BASE_URL = "https://openlibrary.org";
const TIMEOUT_MS = 4000;

type OlBook = {
  title?: string;
  subtitle?: string;
  publish_date?: string;
  publishers?: { name: string }[];
  authors?: { url: string; name: string }[];
  identifiers?: {
    isbn_10?: string[];
    isbn_13?: string[];
    lccn?: string[];
  };
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

// Normalize an LCCN per the Library of Congress spec
// (https://www.loc.gov/marc/lccn-namespace.html):
//   1. Strip whitespace, lowercase letters.
//   2. Drop everything to the right of a forward slash (and the slash).
//   3. If a hyphen is present, remove it and left-pad the post-hyphen
//      substring with zeros so it's 6 chars wide. So `56-11983` → the
//      part after the hyphen is `11983` (5 chars), pads to `011983`,
//      yielding `56011983`. This is the form Open Library's bibkey
//      lookup expects — without padding, OL returns nothing.
export function normalizeLccn(input: string): string {
  let s = input.toLowerCase().replace(/\s+/g, "");
  const slashIdx = s.indexOf("/");
  if (slashIdx >= 0) s = s.slice(0, slashIdx);
  const hyphenIdx = s.indexOf("-");
  if (hyphenIdx >= 0) {
    const left = s.slice(0, hyphenIdx);
    const right = s.slice(hyphenIdx + 1).padStart(6, "0");
    s = left + right;
  }
  return s;
}

// Heuristic variants for inputs that arrive without the hyphen (so the
// pad rule can't trigger). Pre-2001 LCCNs are 8 chars (2-digit year + 6
// serial); post-2001 are 10 chars (4 + 6). If the digits-only form is 7
// or 9, the user almost certainly typed the spaceless form with a
// leading zero dropped — try the padded version too.
function lccnVariants(normalized: string): string[] {
  const variants = [normalized];
  // Only digits → guess pad
  if (/^\d+$/.test(normalized)) {
    if (normalized.length === 7) {
      variants.push(normalized.slice(0, 2) + "0" + normalized.slice(2));
    } else if (normalized.length === 9) {
      variants.push(normalized.slice(0, 4) + "0" + normalized.slice(4));
    }
  }
  return variants;
}

export async function lookupByLccn(
  rawLccn: string,
): Promise<LookupResult | null> {
  const normalized = normalizeLccn(rawLccn);
  if (!normalized) return null;

  for (const candidate of lccnVariants(normalized)) {
    const book = await fetchOlByLccn(candidate);
    if (book) return projectBookToResult(book);
  }
  return null;
}

async function fetchOlByLccn(lccn: string): Promise<OlBook | null> {
  const url = `${BASE_URL}/api/books?bibkeys=${encodeURIComponent(
    `LCCN:${lccn}`,
  )}&format=json&jscmd=data`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/lccn] request failed:", err);
    return null;
  }

  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as OlEnvelope | null;
  if (!json) return null;
  return json[`LCCN:${lccn}`] ?? null;
}

function projectBookToResult(book: OlBook): LookupResult {
  const title = [book.title, book.subtitle].filter(Boolean).join(": ").trim();
  const authors = (book.authors ?? []).map((a) => a.name.trim()).filter(Boolean);
  const publisher = book.publishers?.[0]?.name?.trim() || null;
  const pubDate = book.publish_date?.trim() || null;
  const cover =
    book.cover?.medium || book.cover?.large || book.cover?.small || null;

  // OL subjects on the bibkeys data API are noisy — same curation we apply
  // for ISBN lookups.
  const curatedSubjects = curateOlSubjects(book.subjects);

  const notesText =
    typeof book.notes === "string"
      ? book.notes
      : book.notes?.value || null;
  const excerptText = book.excerpts?.[0]?.text ?? null;
  const description = cleanDescription(notesText ?? excerptText);

  // LCCN-found books often have ISBNs anyway (older editions sometimes got
  // assigned ISBNs retrospectively). Capture them when present so the row
  // can be re-looked-up by ISBN later if the user wants.
  return {
    source: "openlibrary",
    isbn13: book.identifiers?.isbn_13?.[0] ?? null,
    isbn10: book.identifiers?.isbn_10?.[0] ?? null,
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

// Same logic as openlibrary.ts curateOlSubjects — duplicated here to keep
// LCCN's small surface area self-contained. If we add a third caller,
// extract to a shared helper.
function curateOlSubjects(
  raw: OlBook["subjects"] | undefined,
): string[] {
  if (!raw) return [];
  const candidates = raw
    .map((s) => (typeof s === "string" ? s : s?.name))
    .filter((s): s is string => !!s && typeof s === "string")
    .filter((s) => !/--/.test(s))
    .filter((s) => !/^\s*\d{4}s?\s*$/.test(s))
    .filter((s) => !/^\s*\d{1,2}(st|nd|rd|th)\s+century\s*$/i.test(s))
    .filter((s) => !/best\s*sellers?/i.test(s))
    .filter((s) => s.length <= 30)
    .slice(0, 3);
  return cleanSubjectTags(candidates);
}
