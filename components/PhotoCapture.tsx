"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Crop as CropIcon, Images, Loader2, X } from "lucide-react";
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

export default function PhotoCapture({ batchId }: PhotoCaptureProps) {
  const router = useRouter();
  // Two separate file inputs — iOS uses the input's attributes to decide
  // between camera and library, so we expose both as explicit choices
  // rather than hoping the OS shows a chooser.
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | null>(null);

  // Free up the object URL when the user cancels or the component unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPickedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCrop(undefined);
    setPixelCrop(null);
    // Clear both inputs so re-picking the same file still triggers onChange.
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
  }

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

  function cancel() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPickedFile(null);
    setPreviewUrl(null);
    setCrop(undefined);
    setPixelCrop(null);
  }

  async function analyze() {
    if (!pickedFile) return;
    setBusy(true);
    const toastId = toast.loading("Compressing & analyzing photo…");

    try {
      const cropForExport = computeNaturalCrop(pixelCrop, imgRef.current);
      const compressed = await processImage(pickedFile, cropForExport);

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
      if (summary) {
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
      cancel();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        id: toastId,
      });
    } finally {
      setBusy(false);
    }
  }

  // No file picked yet — show two capture options.
  if (!previewUrl) {
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
            <span className="text-muted-foreground text-[11px] font-normal">
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
            <span className="text-muted-foreground text-[11px] font-normal">
              Pick an existing photo
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
            src={previewUrl}
            alt="Captured shelf"
            onLoad={onImageLoad}
            className="max-h-[60vh] w-full object-contain"
          />
        </ReactCrop>
      </div>

      <div className="flex gap-2">
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
          {busy ? "Analyzing…" : "Analyze"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={cancel}
          disabled={busy}
          title="Discard photo"
        >
          <X className="size-4" />
          Cancel
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
