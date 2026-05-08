// Normalize provider-supplied book descriptions: strip HTML tags (Google
// Books occasionally returns <p>…</p> markup), collapse whitespace, cap
// length so a single book doesn't bloat the row or CSV cell.

const MAX_DESCRIPTION_LENGTH = 800;

export function cleanDescription(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  // Strip HTML tags wholesale; we don't want links or formatting in CSV.
  let text = raw.replace(/<[^>]+>/g, " ");
  // Decode the few HTML entities providers actually use.
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse runs of whitespace into single spaces, trim.
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text;
  // Truncate at a sentence boundary if there's one nearby, otherwise hard-cut.
  const truncated = text.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSentence = truncated.lastIndexOf(". ");
  if (lastSentence > MAX_DESCRIPTION_LENGTH * 0.6) {
    return truncated.slice(0, lastSentence + 1);
  }
  return truncated.replace(/\s+\S*$/, "") + "…";
}
