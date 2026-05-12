"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { BatchUpload } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";

type Props = {
  uploads: BatchUpload[];
};

// Photos panel for a batch: shows a thumbnail per vision-photo upload,
// opens a fullscreen lightbox on tap. The lightbox uses a plain <img>
// element so mobile browsers' native pinch-zoom Just Works — no extra
// gesture library. Photos are cleared from Blob at export time, so
// this list naturally drains when the batch ships.
export default function BatchPhotos({ uploads }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (uploads.length === 0) return null;

  const open = openIdx !== null ? uploads[openIdx] : null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Photos
        </h2>
        <span className="text-muted-foreground text-xs">
          {uploads.length} {uploads.length === 1 ? "upload" : "uploads"} ·
          cleared on export
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {uploads.map((u, i) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setOpenIdx(i)}
            className="group relative aspect-square overflow-hidden rounded-lg border bg-muted transition-shadow hover:shadow-md"
            title={`Photo ${i + 1} — ${u.detectedCount} detected, ${u.insertedCount} added`}
          >
            {/* Pure visual element; using <img> not next/image because
                Blob URLs are not in the next.config remotePatterns and
                next/image would 500. Lazy-load to keep the batch page
                snappy when there are many uploads. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={u.blobUrl}
              alt={`Shelf photo ${i + 1}`}
              loading="lazy"
              className="size-full object-cover transition-transform group-hover:scale-105"
            />
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {u.insertedCount} book{u.insertedCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          // Click anywhere outside the image closes the lightbox.
          onClick={() => setOpenIdx(null)}
        >
          <div className="flex items-center justify-between gap-3 p-3 text-white">
            <p className="text-sm font-medium">
              Photo {(openIdx ?? 0) + 1} of {uploads.length}
              <span className="text-white/60">
                {" · "}
                {open.detectedCount} detected, {open.insertedCount} added
              </span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setOpenIdx(null)}
            >
              <X className="size-4" />
              Close
            </Button>
          </div>
          {/* Stop the outer-click-close from firing when tapping the image
              itself — let users pinch-zoom without accidentally closing. */}
          <div
            className="relative flex-1 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={open.blobUrl}
              alt="Shelf photo at full size"
              className="mx-auto block max-h-full w-auto max-w-full"
            />
          </div>
          <p className="p-3 text-center text-xs text-white/60">
            Pinch to zoom · tap outside to close
          </p>
        </div>
      )}
    </section>
  );
}
