// ISBN normalization, validation, and conversion.
// All downstream lookup code keys off ISBN-13.

export type NormalizedIsbn = {
  isbn13: string | null;
  isbn10: string | null;
};

export function stripIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn10(input: string): boolean {
  const s = stripIsbn(input);
  if (s.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += d * (10 - i);
  }
  const last = s[9];
  const check = last === "X" ? 10 : last.charCodeAt(0) - 48;
  if (check < 0 || check > 10) return false;
  sum += check;
  return sum % 11 === 0;
}

export function isValidIsbn13(input: string): boolean {
  const s = stripIsbn(input);
  if (s.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return sum % 10 === 0;
}

export function isbn10To13(input: string): string | null {
  const s = stripIsbn(input);
  if (!isValidIsbn10(s)) return null;
  const body = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = body.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check.toString();
}

export function isbn13To10(input: string): string | null {
  const s = stripIsbn(input);
  if (!isValidIsbn13(s)) return null;
  if (!s.startsWith("978")) return null; // 979-prefixed have no ISBN-10 equivalent
  const body = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (body.charCodeAt(i) - 48) * (10 - i);
  }
  const remainder = (11 - (sum % 11)) % 11;
  const check = remainder === 10 ? "X" : remainder.toString();
  return body + check;
}

export function normalizeIsbn(raw: string): NormalizedIsbn {
  const s = stripIsbn(raw);
  if (s.length === 13 && isValidIsbn13(s)) {
    return { isbn13: s, isbn10: isbn13To10(s) };
  }
  if (s.length === 10 && isValidIsbn10(s)) {
    return { isbn13: isbn10To13(s), isbn10: s };
  }
  return { isbn13: null, isbn10: null };
}

// Normalize user-entered ISBN. If it's a valid 10 or 13 we store both;
// if it's garbage but non-empty, preserve the raw input in isbn13 so the
// user doesn't lose what they typed. Empty input clears both columns.
export function processUserIsbn(input: string | null | undefined): NormalizedIsbn {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return { isbn13: null, isbn10: null };
  const normalized = normalizeIsbn(trimmed);
  if (normalized.isbn13 || normalized.isbn10) return normalized;
  return { isbn13: trimmed, isbn10: null };
}
