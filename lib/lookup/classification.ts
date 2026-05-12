// LCC pattern: 1-3 capital letters, then digits, then optional decimal cutter
// (e.g. ".O72"), then zero-or-more space-separated cutters (e.g. "H37" or
// ".S53"), then an optional 4-digit year. Anchored with word boundaries so we
// can find it inside a longer raw sticker string.
//
// Examples that match:
//   PR6045.O72 H37 1999
//   BX1746 .S53 1986
//   Q175.S94
// Examples that don't:
//   813.54 STE  (starts with digits — DDC, not LCC)
//   FIC TOL     (no digits)
//   YA SF       (no digits)
const LCC_REGEX =
  /\b[A-Z]{1,3}\d+(?:\.[A-Z]\d+)?(?:\s+\.?[A-Z]\d+)*(?:\s+\d{4})?\b/;

// Dewey: 3 digits, optional decimal expansion, then a 2–4 letter cutter.
const DDC_REGEX = /\b\d{3}(?:\.\d+)?\s+[A-Z]{2,4}\b/g;

// Trailing shelf label — only match when followed by a 3-letter all-caps
// cutter, so we don't accidentally clip a real title word like "SF" in
// "The SF of Tomorrow." False negatives (a lone "FIC") are easier to fix
// by hand than false positives.
const TRAILING_SHELF_REGEX =
  /\s+(?:FIC|YA|REF|JUV|BIO|GN|MYS|SF)\s+[A-Z]{3}\b\s*$/;
const LEADING_SHELF_REGEX =
  /^(?:FIC|YA|REF|JUV|BIO|GN|MYS|SF)\s+[A-Z]{3}\s+/;

export function extractLcc(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(LCC_REGEX);
  return match ? cleanLcc(match[0].trim()) : null;
}

// Open Library returns LCC values in their padded MARC display form:
//   "P--0091.00000000.V3 2024"
//   "PR-6045.00000000.O72 H37 1999"
// The human-readable form drops the hyphen separator after the class
// letters, the leading zeros on the class number, and the
// ".00000000" padding block on the decimal extension. Returns the
// canonical form:
//   "P91.V3 2024"
//   "PR6045.O72 H37 1999"
// Idempotent: an already-canonical input passes through unchanged.
export function cleanLcc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // "P--0091" → "P91"; "PR-6045" → "PR6045". One or more hyphens
  // between the class letters and the class number, optional zero
  // padding before the meaningful digits.
  s = s.replace(/([A-Z]{1,3})-+0*(\d+)/g, "$1$2");
  // ".00000000" (padded decimal extension). Block of 4+ zeros after a
  // decimal point is always MARC padding — real cutters like ".A832"
  // start with a letter, not zero.
  s = s.replace(/\.0{4,}/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || null;
}

export function stripSpineSticker(s: string): string {
  if (!s) return s;
  let out = s;
  out = out.replace(new RegExp(LCC_REGEX, "g"), " ");
  out = out.replace(DDC_REGEX, " ");
  out = out.replace(TRAILING_SHELF_REGEX, "");
  out = out.replace(LEADING_SHELF_REGEX, "");
  out = out.replace(/\s+/g, " ").trim();
  return out || s;
}
