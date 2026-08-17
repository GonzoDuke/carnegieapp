// Spine labels are printed stacked, one element per line:
//
//     E
//     184
//     .A75
//     A125
//     2019
//
// so vision reads them back as "E 184 .A75 A125 2019" — with a space between
// the class letters and the class number. The previous pattern required them
// to be adjacent (`[A-Z]{1,3}\d+`), which meant it couldn't match "E 184" at
// all. It then skipped ahead and matched the CUTTER as though it were the
// class, turning "DS 126.5 .R37 2008" into "R37 2008" and "F 1410 .C727 2008"
// into "C727 2008" — a call number that points nowhere.
//
// This version allows the space, allows a decimal in the class number
// (DS126.5), and allows cutters written with or without their leading period.
//
// Matches:
//   E 184 .A75 A125 2019     ->  E184 .A75 A125 2019
//   DS 126.5 .R37 2008       ->  DS126.5 .R37 2008
//   DC 148 D5313 1989        ->  DC148 .D5313 1989
//   PR6045.O72 H37 1999      ->  PR6045 .O72 H37 1999
// Doesn't match:
//   813.54 STE   (leading digits — Dewey, not LC)
//   FIC TOL      (no digits)
//   SHERIDAN     (no digits)
const LCC_REGEX =
  /\b([A-Z]{1,3})\s*(\d{1,4}(?:\.\d+)?)((?:\s*\.\s*[A-Z]+\d+|\s+[A-Z]\d+)*)(?:\s+(\d{4}))?/;

// Stripping a call number out of a TITLE is a different risk than reading one
// out of a field that's supposed to contain one. "USA 1776" is a plausible
// title fragment and matches the permissive pattern above, so the strip
// variant additionally requires at least one cutter — which every real LC
// spine label has. False negatives here are harmless; false positives quietly
// corrupt the title we hand to the lookup chain.
const LCC_STRIP_REGEX =
  /\b[A-Z]{1,3}\s*\d{1,4}(?:\.\d+)?(?:\s*\.\s*[A-Z]+\d+|\s+[A-Z]\d+)+(?:\s+\d{4})?/g;

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

export type ParsedLcc = {
  /** Canonical form, e.g. "E184 .A75 A125 2019". */
  value: string;
  /**
   * True when the call number carries at least one cutter — i.e. it points
   * at a shelf position rather than just a subject class. "DT14" is a real
   * but weak read; "DT14 .C653 2019" is a shelf address. Callers use this to
   * decide whether a sticker read is good enough to beat a lookup provider.
   */
  complete: boolean;
};

// Pull an LC call number out of arbitrary text (a spine sticker, usually).
export function parseLcc(text: string | null | undefined): ParsedLcc | null {
  if (!text) return null;
  const m = text.match(LCC_REGEX);
  if (!m) return null;

  const [, letters, number, cutterBlob, year] = m;
  const cutters = (cutterBlob || "")
    .split(/\s+|(?=\.)/)
    .map((c) => c.replace(/^\.+/, "").trim())
    .filter(Boolean);

  let value = `${letters}${number}`;
  if (cutters.length > 0) value += ` .${cutters[0]}`;
  if (cutters.length > 1) value += ` ${cutters.slice(1).join(" ")}`;
  if (year) value += ` ${year}`;

  return { value, complete: cutters.length > 0 };
}

export function extractLcc(text: string | null): string | null {
  return parseLcc(text)?.value ?? null;
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
  out = out.replace(LCC_STRIP_REGEX, " ");
  out = out.replace(DDC_REGEX, " ");
  out = out.replace(TRAILING_SHELF_REGEX, "");
  out = out.replace(LEADING_SHELF_REGEX, "");
  out = out.replace(/\s+/g, " ").trim();
  return out || s;
}
