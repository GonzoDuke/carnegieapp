// Subject-tag cleaning shared by all lookup providers.
//
// LibraryThing tags are short, lowercase, and not particularly hierarchical.
// Catalog providers return subjects in wildly different shapes, so we
// normalize before persisting to the book row:
//   - Google Books: slash-separated paths like "Fiction / Science Fiction / General"
//   - ISBNdb: short subject phrases, sometimes with mixed casing
// After cleaning we cap at MAX_TAGS_PER_BOOK so a single chatty source can't
// flood the user's LibraryThing tag pool.

const MAX_TAGS_PER_BOOK = 5;

// Generic terms that show up at the leaves of category paths and don't add
// information. Cleaned out so we don't end up with bare "general" tags.
const NOISE_TERMS = new Set([
  "general",
  "miscellaneous",
  "books",
  "uncategorized",
  "other",
]);

export function cleanSubjectTags(raw: readonly string[] | undefined | null): string[] {
  if (!raw || raw.length === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "string") continue;
    // Each Google Books category may contain a "/"-separated path. Split,
    // then trim each segment.
    const segments = item.split("/").map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const tag = segment.toLowerCase();
      if (NOISE_TERMS.has(tag)) continue;
      if (tag.length < 2 || tag.length > 60) continue;
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
      if (out.length >= MAX_TAGS_PER_BOOK) return out;
    }
  }

  return out;
}
