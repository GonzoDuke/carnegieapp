export type LookupSource = "isbndb" | "openlibrary" | "googlebooks";

export type LookupResult = {
  source: LookupSource;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  pubDate: string | null;
  coverUrl: string | null;
  // Cleaned subject tags from the source provider's category metadata.
  // Empty array if the provider has no category data or we choose to skip
  // theirs (Open Library is too noisy by design).
  subjects: string[];
  // Library of Congress Classification (call number) when available.
  // Practically only Open Library exposes this on the bibkeys data API.
  lcc: string | null;
  // Book synopsis / description. Most providers expose one (Google Books'
  // `description`, ISBNdb's `synopsys`, OL's `notes`). Capped to a sane
  // length at extraction time so we don't store novel-sized blobs.
  description: string | null;
  raw: unknown;
};

export function isAcceptable(result: LookupResult | null): result is LookupResult {
  return !!result && result.title.trim().length > 0 && result.authors.length > 0;
}
