"use client";

import { useState } from "react";
import { ImageOff, X } from "lucide-react";

export type SharePhoto = {
  id: string;
  blobUrl: string;
  boxLabel: string | null;
};

type Props = {
  photos: SharePhoto[];
};

type Group = { label: string; photos: SharePhoto[] };

// Read-only photo gallery for the public share view. Same thumbnail-grid +
// fullscreen-lightbox shape as the operator's BatchPhotos, but with all the
// crop / re-read machinery stripped out — colleagues only look. Photos are
// grouped under their box label so "what's in Box 2" reads at a glance;
// unlabeled photos collect under a trailing "Unlabeled" heading.
export default function ShareGallery({ photos }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (photos.length === 0) return null;

  const groups: Group[] = [];
  const byLabel = new Map<string, SharePhoto[]>();
  for (const p of photos) {
    const label = p.boxLabel?.trim() || "Unlabeled";
    let bucket = byLabel.get(label);
    if (!bucket) {
      bucket = [];
      byLabel.set(label, bucket);
      groups.push({ label, photos: bucket });
    }
    bucket.push(p);
  }
  const showHeadings = groups.length > 1 || groups[0].label !== "Unlabeled";

  const open = openId ? photos.find((p) => p.id === openId) ?? null : null;

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl font-semibold tracking-tight">
        Box photos
        <span className="text-muted-foreground ml-1.5 text-sm font-normal">
          ({photos.length})
        </span>
      </h2>

      {groups.map((g) => (
        <div key={g.label} className="space-y-2">
          {showHeadings && (
            <h3 className="text-muted-foreground flex items-baseline gap-1.5 text-sm font-medium">
              {g.label}
              <span className="text-xs font-normal">
                {g.photos.length} {g.photos.length === 1 ? "photo" : "photos"}
              </span>
            </h3>
          )}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {g.photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenId(p.id)}
                className="group bg-muted relative aspect-square overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
                title={`${g.label} — photo ${i + 1}`}
              >
                {/* Plain <img>: Blob URLs aren't in next.config remotePatterns,
                    so next/image would 500. Lazy-load to keep the grid snappy. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.blobUrl}
                  alt={`${g.label} photo ${i + 1}`}
                  loading="lazy"
                  className="size-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </div>
      ))}

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={() => setOpenId(null)}
        >
          <div className="flex items-center justify-between gap-3 p-3 text-white">
            <p className="text-sm font-medium">
              {open.boxLabel?.trim() || "Unlabeled"}
            </p>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10"
            >
              <X className="size-4" />
              Close
            </button>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {open.blobUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={open.blobUrl}
                alt={open.boxLabel?.trim() || "Box photo"}
                className="block"
                style={{
                  maxHeight: "calc(100vh - 7rem)",
                  maxWidth: "calc(100vw - 2rem)",
                }}
              />
            ) : (
              <ImageOff className="size-10 text-white/40" />
            )}
          </div>
          <p className="p-3 text-center text-xs text-white/60">
            Pinch to zoom · tap outside to close
          </p>
        </div>
      )}
    </section>
  );
}
