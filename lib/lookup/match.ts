// Loose author-name overlap check. Tokenizes both sides into words 4+
// characters long (catches surnames, drops initials and articles) and
// returns true if any token appears on both sides.
//
// Lenient enough to match "Frank Herbert" with "Herbert, Frank P." but
// strict enough to reject "Jean Baudrillard" vs "Christina W. Randall"
// — which is exactly the failure mode where a generic title (e.g.
// "America") title-searches to a completely different book.
//
// When either side is empty we return true: caller can't make a
// rejection decision without both sides, and the caller already knows
// to skip the check in that case if it wants stricter behavior.
export function authorsLikelyMatch(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []);
  const left = new Set<string>();
  for (const e of a) for (const t of tokenize(e)) left.add(t);
  for (const i of b) {
    for (const t of tokenize(i)) {
      if (left.has(t)) return true;
    }
  }
  return false;
}
