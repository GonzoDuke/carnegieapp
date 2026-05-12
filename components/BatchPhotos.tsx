"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crop as CropIcon, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import ReactCrop, { type Crop, type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import type { BatchUpload } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";

type Props = {
  uploads: BatchUpload[];
};

// Photos panel for a batch: shows a thumbnail per vision-photo upload,
// opens a fullscreen lightbox on tap. In the lightbox the user can
// switch to "Crop & re-read" mode to frame a single missed book and
// fire a targeted Opus re-extract — output lands in the same pending
// review queue as the original photo's books.
export default function BatchPhotos({ uploads }: Props) {
  const router = useRouter();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<Crop | undefined>(undefined);
  const [percentCrop, setPercentCrop] = useState<PercentCrop | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (uploads.length === 0) return null;

  const open = openIdx !== null ? uploads[openIdx] : null;

  function closeLightbox() {
    setOpenIdx(null);
    setCropMode(false);
    setCrop(undefined);
    setPercentCrop(undefined);
  }

  async function submitCrop() {
    if (!open || !percentCrop) return;
    if (percentCrop.width < 2 || percentCrop.height < 2) {
      toast.error("Draw a bigger rectangle around the book.");
      return;
    }
    setBusy(true);
    const toastId = toast.loading("Re-reading the crop with Opus…");
    try {
      const res = await fetch(
        `/api/batches/${open.batchId}/uploads/${open.id}/recrop`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // ReactCrop reports percentages 0–100; the API wants 0–1
            // fractions. Divide here.
            x: percentCrop.x / 100,
            y: percentCrop.y / 100,
            width: percentCrop.width / 100,
            height: percentCrop.height / 100,
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        summary?: { detected?: number; inserted?: number };
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? `Re-read failed (${res.status})`);
      }
      const detected = json?.summary?.detected ?? 0;
      const inserted = json?.summary?.inserted ?? 0;
      if (inserted > 0) {
        toast.success(
          `Added ${inserted} book${inserted === 1 ? "" : "s"} from the crop.`,
          { id: toastId, description: "Check the pending review queue." },
        );
      } else if (detected === 0) {
        toast.warning("Nothing detected in that crop.", {
          id: toastId,
          description: "Try a different rectangle or zoom in more.",
        });
      } else {
        toast.success(`Detected ${detected} but inserted ${inserted}.`, {
          id: toastId,
        });
      }
      closeLightbox();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        id: toastId,
      });
    } finally {
      setBusy(false);
    }
  }

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
          // Outer-click closes only in view mode — when cropping, the
          // ReactCrop drag wrappers swallow most clicks anyway, but
          // disabling close prevents the modal from vanishing mid-drag.
          onClick={cropMode ? undefined : closeLightbox}
        >
          <div className="flex items-center justify-between gap-3 p-3 text-white">
            <p className="text-sm font-medium">
              Photo {(openIdx ?? 0) + 1} of {uploads.length}
              <span className="text-white/60">
                {" · "}
                {open.detectedCount} detected, {open.insertedCount} added
              </span>
            </p>
            <div className="flex gap-2">
              {!cropMode ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/10 hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCropMode(true);
                  }}
                  disabled={busy}
                >
                  <CropIcon className="size-4" />
                  Crop & re-read
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/10 hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCropMode(false);
                    setCrop(undefined);
                    setPercentCrop(undefined);
                  }}
                  disabled={busy}
                >
                  Cancel crop
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  closeLightbox();
                }}
                disabled={busy}
              >
                <X className="size-4" />
                Close
              </Button>
            </div>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {cropMode ? (
              <ReactCrop
                crop={crop}
                onChange={(c, pc) => {
                  setCrop(c);
                  setPercentCrop(pc);
                }}
                keepSelection
                ruleOfThirds={false}
              >
                {/* ReactCrop wraps the image in an inline-block container
                    which breaks max-h-full's height reference (the wrapper
                    sizes to content, so the image has no parent height
                    to be 100% of, and falls back to natural size). Use
                    absolute viewport units instead, sized to match what
                    view-mode renders to. The 7rem subtracts roughly the
                    header (3rem) + footer (4rem with the crop controls). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={open.blobUrl}
                  alt="Shelf photo at full size"
                  className="block"
                  style={{
                    maxHeight: "calc(100vh - 7rem)",
                    maxWidth: "calc(100vw - 2rem)",
                  }}
                />
              </ReactCrop>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={open.blobUrl}
                alt="Shelf photo at full size"
                className="block"
                style={{
                  maxHeight: "calc(100vh - 7rem)",
                  maxWidth: "calc(100vw - 2rem)",
                }}
              />
            )}
          </div>
          {cropMode ? (
            <div className="flex items-center justify-between gap-3 p-3">
              <p className="text-xs text-white/70">
                Drag a rectangle around the book vision missed. Tap
                Re-read to extract.
              </p>
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  submitCrop();
                }}
                disabled={busy || !percentCrop}
              >
                <Sparkles className="size-4" />
                {busy ? "Re-reading…" : "Re-read this crop"}
              </Button>
            </div>
          ) : (
            <p className="p-3 text-center text-xs text-white/60">
              Pinch to zoom · tap outside to close
            </p>
          )}
        </div>
      )}
    </section>
  );
}
