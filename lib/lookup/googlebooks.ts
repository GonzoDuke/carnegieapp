import type { LookupResult } from "./types";
import { cleanSubjectTags } from "./subjects";
import { cleanDescription } from "./description";

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

type GbResponse = { items?: GbVolume[]; totalItems?: number };

export async function lookupGoogleBooks(isbn13: string): Promise<LookupResult | null> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const params = new URLSearchParams({ q: `isbn:${isbn13}` });
  if (apiKey) params.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[lookup/googlebooks] request failed:", err);
    return null;
  }

  if (!response.ok) return null;

  const json = (await response.json().catch(() => null)) as GbResponse | null;
  const info = json?.items?.[0]?.volumeInfo;
  if (!info) return null;

  const title = [info.title, info.subtitle].filter(Boolean).join(": ").trim();
  const authors = (info.authors ?? []).map((a) => a.trim()).filter(Boolean);
  const ids = info.industryIdentifiers ?? [];
  const isbn13Out = ids.find((i) => i.type === "ISBN_13")?.identifier ?? isbn13;
  const isbn10Out = ids.find((i) => i.type === "ISBN_10")?.identifier ?? null;

  return {
    source: "googlebooks",
    isbn13: isbn13Out,
    isbn10: isbn10Out,
    title,
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

// Google Books returns http URLs that get blocked as mixed content on https,
// so we upgrade them. Prefer larger thumbnails when available.
export function pickGoogleBooksCover(
  links: GbVolumeInfo["imageLinks"] | undefined,
): string | null {
  if (!links) return null;
  const url =
    links.large ||
    links.medium ||
    links.thumbnail ||
    links.small ||
    links.smallThumbnail ||
    null;
  if (!url) return null;
  // Strip the curl edge effect and bump zoom for sharper thumbnails.
  return url.replace(/^http:/, "https:").replace(/&edge=curl/g, "").replace(/&zoom=\d+/, "&zoom=1");
}
