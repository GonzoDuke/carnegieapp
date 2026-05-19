"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Crop as CropIcon,
  Images,
  Loader2,
  SkipForward,
  X,
} from "lucide-react";
import { toast } from "sonner";
import ReactCrop, {
  centerCrop,
  type Crop,
  type PercentCrop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";

type PhotoCaptureProps = {
  batchId: string;
};

const MAX_LONG_EDGE = 2048;
const JPEG_QUALITY = 0.85;

type ApiSummary = {
  detected: number;
  inserted: number;
  budget: { used: number; limit: number; remaining: number };
};

type Aggregate = {
  succeeded: number;
  failed: { name: string; error: string }[];
  detected: number;
  inserted: number;
  budget: ApiSummary["budget"] | null;
};

const EMPTY_AGGREGATE: Aggregate = {
  succeeded: 0,
  failed: [],
  detected: 0,
  inserted: 0,
  budget: null,
};

export default function PhotoCapture({ batchId }: PhotoCaptureProps) {
  const router = useRouter();
  // Two separate file inputs — iOS uses the input's attributes to decide
  // between camera and library, so we expose both as explicit choices
  // rather than hoping the OS shows a chooser. The library input is now
  // `multiple`; camera capture stays single-shot (phones can't multi-
  // shoot through <input capture> anyway).
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  // Queue of pending photos. Current photo is queue[0]; finished/skipped
  // photos are shifted off as we go. Single-shot picks (camera, or one
  // file from the library) put a 1-length queue here, and the existing
  // crop+analyze UI behaves exactly as before.
  const [queue, setQueue] = useState<File[]>([]);
  const [totalQueued, setTotalQueued] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | null>(null);
  const [aggregate, setAggregate] = useState<Aggregate>(EMPTY_AGGREGATE);

  const currentFile = queue[0] ?? null;
  const isBatch = totalQueued > 1;
  const photoIndex = totalQueued - queue.length + 1; // 1-based

  // Generate / clean up preview URL as the current photo changes.
  // Each photo starts with no crop set, so onImageLoad re-initializes to
  // the full-image rectangle.
  useEffect(() => {
    if (!currentFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(currentFile);
    setPreviewUrl(url);
    setCrop(undefined);
    setPixelCrop(null);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  function onImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    // Default the crop rectangle to the full image so "Analyze" with no
    // dragging is a no-op (sends the full image, same as before crop existed).
    const { naturalWidth, naturalHeight } = event.currentTarget;
    const initial: PercentCrop = centerCrop(
      { unit: "%", x: 0, y: 0, width: 100, height: 100 },
      naturalWidth,
      naturalHeight,
    );
    setCrop(initial);
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setQueue(files);
    setTotalQueued(files.length);
    setAggregate(EMPTY_AGGREGATE);
    // Clear both inputs so re-picking the same file still triggers onChange.
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
  }

  function cancelAll() {
    // Bail out of the whole queue. If we're partway through a batch,
    // surface what was already processed.
    if (totalQueued > 1 && (aggregate.succeeded > 0 || aggregate.failed.length > 0)) {
      finishBatch(aggregate);
    }
    setQueue([]);
    setTotalQueued(0);
    setAggregate(EMPTY_AGGREGATE);
    setCrop(undefined);
    setPixelCrop(null);
  }

  function finishBatch(finalAggregate: Aggregate) {
    if (finalAggregate.succeeded === 0 && finalAggregate.failed.length === 0) {
      return;
    }
    const headline =
      finalAggregate.succeeded === 1
        ? `Processed 1 photo · detected ${finalAggregate.detected} books`
        : `Processed ${finalAggregate.succeeded} photos · detected ${finalAggregate.detected} books`;
    const description = [
      `Added ${finalAggregate.inserted} to review.`,
      finalAggregate.failed.length > 0
        ? `${finalAggregate.failed.length} ${
            finalAggregate.failed.length === 1 ? "photo" : "photos"
          } failed.`
        : null,
      finalAggregate.budget
        ? `Budget left today: ${finalAggregate.budget.remaining}/${finalAggregate.budget.limit}.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (finalAggregate.failed.length > 0 && finalAggregate.succeeded === 0) {
      toast.error("All photos failed", { description });
    } else if (finalAggregate.failed.length > 0) {
      toast.warning(headline, { description });
    } else {
      toast.success(headline, { description });
    }
    router.refresh();
  }

  async function analyze() {
    if (!currentFile) return;
    setBusy(true);
    const label = isBatch
      ? `Analyzing photo ${photoIndex} of ${totalQueued}…`
      : "Compressing & analyzing photo…";
    const toastId = toast.loading(label);

    let success = false;
    let nextAggregate = aggregate;

    try {
      const cropForExport = computeNaturalCrop(pixelCrop, imgRef.current);
      const compressed = await processImage(currentFile, cropForExport);

      const form = new FormData();
      form.append("image", compressed, "shelf.jpg");
      const res = await fetch(`/api/batches/${batchId}/vision`, {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error || `Upload failed (${res.status})`);
      }

      const summary = json?.summary as ApiSummary | undefined;
      nextAggregate = {
        succeeded: aggregate.succeeded + 1,
        failed: aggregate.failed,
        detected: aggregate.detected + (summary?.detected ?? 0),
        inserted: aggregate.inserted + (summary?.inserted ?? 0),
        budget: summary?.budget ?? aggregate.budget,
      };
      setAggregate(nextAggregate);
      success = true;

      if (isBatch) {
        toast.success(
          `Photo ${photoIndex}: ${summary?.detected ?? 0} detected · ${
            summary?.inserted ?? 0
          } added`,
          { id: toastId },
        );
      } else if (summary) {
        toast.success(
          `Detected ${summary.detected} books · added ${summary.inserted} to review.`,
          {
            id: toastId,
            description: `Budget left today: ${summary.budget.remaining}/${summary.budget.limit}.`,
          },
        );
      } else {
        toast.success("Photo processed.", { id: toastId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      nextAggregate = {
        ...aggregate,
        failed: [...aggregate.failed, { name: currentFile.name, error: message }],
      };
      setAggregate(nextAggregate);
      if (isBatch) {
        toast.error(`Photo ${photoIndex}: ${message}`, { id: toastId });
      } else {
        toast.error(message, { id: toastId });
      }
    } finally {
      setBusy(false);
    }

    // Advance only in batch mode OR on success. Single-photo failures
    // keep the current photo so the user can retry without re-picking
    // (matches the pre-multi-import behavior).
    const shouldAdvance = isBatch || success;
    if (!shouldAdvance) return;

    const remaining = queue.slice(1);
    setQueue(remaining);
    if (remaining.length === 0) {
      if (isBatch) {
        finishBatch(nextAggregate);
      } else if (success) {
        router.refresh();
      }
      setTotalQueued(0);
      setAggregate(EMPTY_AGGREGATE);
    }
  }

  function skipCurrent() {
    if (busy || !isBatch) return;
    const remaining = queue.slice(1);
    setQueue(remaining);
    if (remaining.length === 0) {
      finishBatch(aggregate);
      setTotalQueued(0);
      setAggregate(EMPTY_AGGREGATE);
    }
  }

  // No file picked yet — show two capture options.
  if (!currentFile) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col gap-1 py-4"
            onClick={() => cameraInputRef.current?.click()}
            disabled={busy}
          >
            <Camera className="size-5" />
            <span className="text-sm font-medium">Take photo</span>
            <span className="text-muted-foreground text-xs font-normal">
              Use the camera
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col gap-1 py-4"
            onClick={() => libraryInputRef.current?.click()}
            disabled={busy}
          >
            <Images className="size-5" />
            <span className="text-sm font-medium">From library</span>
            <span className="text-muted-foreground text-xs font-normal">
              Pick one or more
            </span>
          </Button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFileChosen}
          disabled={busy}
          className="sr-only"
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFileChosen}
          disabled={busy}
          className="sr-only"
        />
      </div>
    );
  }

  // File picked — show crop + analyze flow.
  return (
    <div className="space-y-3">
      {isBatch && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            Photo <span className="text-foreground font-medium">{photoIndex}</span>{" "}
            of {totalQueued}
          </span>
          {(aggregate.succeeded > 0 || aggregate.failed.length > 0) && (
            <span>
              {aggregate.succeeded} done · {aggregate.detected} detected
              {aggregate.failed.length > 0 ? ` · ${aggregate.failed.length} failed` : ""}
            </span>
          )}
        </div>
      )}
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <CropIcon className="size-3" />
        Drag the corners to crop, or click Analyze to use the full image.
      </div>

      <div className="bg-muted overflow-hidden rounded-md">
        <ReactCrop
          crop={crop}
          onChange={(_, percentCrop) => setCrop(percentCrop)}
          onComplete={(c) => setPixelCrop(c)}
          ruleOfThirds
          className="!max-h-[60vh] !w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={previewUrl ?? undefined}
            alt="Captured shelf"
            onLoad={onImageLoad}
            className="max-h-[60vh] w-full object-contain"
          />
        </ReactCrop>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={analyze}
          disabled={busy}
          className="flex-1"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Camera className="size-4" />
          )}
          {busy
            ? "Analyzing…"
            : isBatch
              ? `Analyze (${photoIndex}/${totalQueued})`
              : "Analyze"}
        </Button>
        {isBatch && (
          <Button
            type="button"
            variant="outline"
            onClick={skipCurrent}
            disabled={busy}
            title="Skip this photo and move to the next"
          >
            <SkipForward className="size-4" />
            Skip
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={cancelAll}
          disabled={busy}
          title={isBatch ? "Discard remaining photos" : "Discard photo"}
        >
          <X className="size-4" />
          {isBatch ? "Cancel all" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

// react-image-crop reports PixelCrop in *displayed* pixels (relative to the
// rendered <img>), not the image's natural resolution. We scale to natural
// pixels before applying the crop to the underlying bitmap. If we used
// displayed coords directly against the full-resolution bitmap we'd crop a
// tiny region from the top-left and lose almost all of the image.
function computeNaturalCrop(
  displayed: PixelCrop | null,
  img: HTMLImageElement | null,
): PixelCrop | null {
  if (!displayed || !img) return null;
  if (displayed.width <= 0 || displayed.height <= 0) return null;
  if (img.width <= 0 || img.height <= 0) return null;

  const scaleX = img.naturalWidth / img.width;
  const scaleY = img.naturalHeight / img.height;

  const naturalX = displayed.x * scaleX;
  const naturalY = displayed.y * scaleY;
  const naturalW = displayed.width * scaleX;
  const naturalH = displayed.height * scaleY;

  // If the crop is essentially the full image, skip the crop step entirely
  // so the existing no-crop pipeline runs unchanged.
  const isFullWidth = naturalW / img.naturalWidth > 0.99;
  const isFullHeight = naturalH / img.naturalHeight > 0.99;
  const startsAtOrigin =
    naturalX < img.naturalWidth * 0.005 && naturalY < img.naturalHeight * 0.005;
  if (isFullWidth && isFullHeight && startsAtOrigin) return null;

  return {
    unit: "px",
    x: Math.round(naturalX),
    y: Math.round(naturalY),
    width: Math.round(naturalW),
    height: Math.round(naturalH),
  };
}

// Pipeline: optional crop → resize so the long edge is ≤ MAX_LONG_EDGE →
// JPEG at JPEG_QUALITY. When the user crops tight, the cropped region gets
// the full pixel budget, which gives the model better resolution per spine.
async function processImage(
  file: File,
  crop: PixelCrop | null,
): Promise<Blob> {
  // `imageOrientation: "from-image"` honors the EXIF rotation tag iOS/Android
  // phones embed in portrait photos. Without this, Safari (and older browsers)
  // return a bitmap in raw sensor orientation, so the cropped output ends up
  // sideways relative to what the user saw in the crop UI.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.width : bitmap.width;
  const sh = crop ? crop.height : bitmap.height;

  const longEdge = Math.max(sw, sh);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const targetW = Math.round(sw * scale);
  const targetH = Math.round(sh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetW, targetH);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Image compression failed"));
        else resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
