"use client";

import { useMemo, useState } from "react";
import { BookOpen } from "lucide-react";

type Size = "xs" | "sm" | "md" | "lg";

type Props = {
  /** Persisted cover URL from a successful lookup. Highest-priority source. */
  coverUrl?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  /** Convenience for callers that only have a single ISBN handy. */
  isbn?: string | null;
  title: string;
  size?: Size;
  className?: string;
};

const SIZE_CLASSES: Record<Size, string> = {
  xs: "w-8 h-12 rounded",
  sm: "w-12 h-[4.5rem] rounded-md",
  md: "w-20 h-30 rounded-md",
  lg: "w-28 h-40 rounded-lg",
};

const ICON_CLASSES: Record<Size, string> = {
  xs: "size-3",
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

function openLibraryUrl(isbn: string): string {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg?default=false`;
}

function buildCandidates({
  coverUrl,
  isbn13,
  isbn10,
  isbn,
}: Pick<Props, "coverUrl" | "isbn13" | "isbn10" | "isbn">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | null | undefined) => {
    if (!u) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  // Order: stored URL (highest fidelity, came from the same provider that
  // matched the book), then Open Library by 13, then by 10. Each src will be
  // tried in turn; <img onError> advances to the next.
  push(coverUrl);
  if (isbn13) push(openLibraryUrl(isbn13));
  if (isbn10) push(openLibraryUrl(isbn10));
  if (isbn && isbn !== isbn13 && isbn !== isbn10) push(openLibraryUrl(isbn));
  return out;
}

export function BookCover({
  coverUrl,
  isbn13,
  isbn10,
  isbn,
  title,
  size = "md",
  className,
}: Props) {
  const candidates = useMemo(
    () => buildCandidates({ coverUrl, isbn13, isbn10, isbn }),
    [coverUrl, isbn13, isbn10, isbn],
  );
  const [idx, setIdx] = useState(0);
  const sizeClass = SIZE_CLASSES[size];
  const iconClass = ICON_CLASSES[size];

  const url = candidates[idx];

  if (!url) {
    // Stylized fallback: gradient-tinted "spine" with a title initial.
    const initial = title.trim().charAt(0).toUpperCase() || "?";
    return (
      <div
        className={`${sizeClass} from-primary/15 to-primary/5 text-primary border-primary/20 relative flex shrink-0 items-center justify-center overflow-hidden border bg-gradient-to-br shadow-sm ${className ?? ""}`}
        title={title}
      >
        <span className="font-heading text-lg font-medium">{initial}</span>
        <BookOpen className={`absolute bottom-1 right-1 ${iconClass} opacity-30`} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={url}
      src={url}
      alt={title}
      loading="lazy"
      // Some cover hosts (notably images.isbndb.com) hotlink-block by Referer
      // and return a 200 OK with an empty body — which fires onError and
      // dumps us into the gradient placeholder. Stripping the Referer fixes
      // the block without changing what we store. OL / Google Books cover
      // hosts don't care about Referer, so this is a free win.
      referrerPolicy="no-referrer"
      onError={() => setIdx((i) => i + 1)}
      className={`${sizeClass} bg-muted shrink-0 object-cover shadow-sm ring-1 ring-black/5 ${className ?? ""}`}
    />
  );
}
