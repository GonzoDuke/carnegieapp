// Library of Congress as an LCC source. LoC's SRU endpoint returns
// MARC XML for any book they've cataloged; MARC field 050 carries
// the canonical Library of Congress Classification call number.
//
// LoC is preferred over Open Library for LCC because it IS the
// source — OL borrows LoC catalog data and sometimes lags or
// omits it. When LoC has the record, its LCC is the right answer.
//
// LoC's coverage:
//   - Most US-published books since ~1960
//   - Spotty for self-published, foreign editions, ephemera
//   - The book has to have been *deposited* with LoC for cataloging,
//     not just printed
//
// This provider returns an LCC-only LookupResult — empty title /
// authors so isAcceptable() rejects it as a primary winner. The
// orchestrator in index.ts harvests its LCC via the cross-source
// enrichment pass. We're not trying to compete with ISBNdb / OL / GB
// on metadata; we're filling the LCC gap.
import type { LookupResult } from "./types.ts";
import type { NormalizedIsbn } from "./isbn.ts";
import { cleanLcc } from "./classification.ts";

const SRU_URL = "http://lx2.loc.gov:210/lcdb";
const TIMEOUT_MS = 8000;

export async function lookupLoc(
  isbn: NormalizedIsbn,
): Promise<LookupResult | null> {
  const query = isbn.isbn13 ?? isbn.isbn10;
  if (!query) return null;

  const params = new URLSearchParams({
    version: "1.1",
    operation: "searchRetrieve",
    query: `bath.isbn=${query}`,
    maximumRecords: "1",
    recordSchema: "marcxml",
  });

  let response: Response;
  try {
    response = await fetch(`${SRU_URL}?${params.toString()}`, {
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/loc] request failed:", err);
    return null;
  }
  if (!response.ok) return null;
  const xml = await response.text().catch(() => "");
  if (!xml) return null;

  // LoC's SRU echoes the request even when there's nothing to return,
  // so an empty response isn't a parse error — it's a real "no result."
  // We only need to look at MARC field 050 ("Library of Congress Call
  // Number"). $a is the classification stem (e.g. "PR4034"), $b is the
  // item number and date (e.g. ".P7 2003b"). Concatenate with a single
  // space — the canonical display form.
  const lcc = extractLcc050(xml);
  if (!lcc) return null;

  return {
    source: "loc",
    isbn13: isbn.isbn13,
    isbn10: isbn.isbn10,
    // LoC's role here is LCC enrichment only. Empty title/authors
    // means isAcceptable() rejects this record as a primary winner;
    // the enrichResult pass in index.ts still picks up the LCC.
    title: "",
    authors: [],
    publisher: null,
    pubDate: null,
    coverUrl: null,
    subjects: [],
    lcc: cleanLcc(lcc),
    description: null,
    raw: { xml: xml.slice(0, 4000) }, // first 4 KB for debug
  };
}

// Regex against MARC XML for field 050. We pick the FIRST 050 datafield
// (LoC catalogs sometimes have multiple — first is the canonical one),
// then concatenate its $a and $b subfields. A full XML parser would be
// safer, but the MARC fragment is regular and stable enough that the
// regex is fine — and we avoid pulling in an XML library for one field.
function extractLcc050(xml: string): string | null {
  const fieldMatch = xml.match(
    /<datafield\s+tag="050"[^>]*>([\s\S]*?)<\/datafield>/,
  );
  if (!fieldMatch) return null;
  const inner = fieldMatch[1];
  const subA = inner.match(/<subfield\s+code="a">([^<]+)<\/subfield>/);
  const subB = inner.match(/<subfield\s+code="b">([^<]+)<\/subfield>/);
  const parts = [subA?.[1]?.trim(), subB?.[1]?.trim()].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" ");
}
