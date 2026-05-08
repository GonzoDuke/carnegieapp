"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBarcode, StopCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Button } from "@/components/ui/button";

type BarcodeScannerProps = {
  batchId: string;
};

export default function BarcodeScanner({ batchId }: BarcodeScannerProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<IScannerControls | null>(null);
  const [scanning, setScanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      scannerRef.current?.stop();
    };
  }, []);

  async function postScan(code: string) {
    setIsSubmitting(true);
    const toastId = toast.loading(`Looking up ${code}…`);

    try {
      const response = await fetch(`/api/batches/${batchId}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to save scanned book.");
      }

      const payload = (await response.json()) as {
        book?: { title?: string; authors?: string[] };
        lookup?: { matched?: boolean; source?: string | null };
      };
      const title = payload.book?.title;
      const authors = payload.book?.authors?.join(" / ");

      if (payload.lookup?.matched && title) {
        toast.success(title, {
          id: toastId,
          description: authors
            ? `${authors} · via ${payload.lookup.source ?? "lookup"}`
            : `via ${payload.lookup.source ?? "lookup"}`,
        });
      } else {
        toast.warning(`Lookup failed for ${code}`, {
          id: toastId,
          description: "Book added to review queue. Edit it below.",
        });
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        id: toastId,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function startScan() {
    if (!videoRef.current) {
      toast.error("Camera video element is unavailable.");
      return;
    }

    const codeReader = new BrowserMultiFormatReader();
    setScanning(true);

    try {
      const controls = await codeReader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result, _error, controls) => {
          scannerRef.current = controls;
          if (result?.getText()) {
            const code = result.getText();
            controls.stop();
            setScanning(false);
            await postScan(code);
          }
        },
      );
      scannerRef.current = controls;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Barcode scan failed.");
      setScanning(false);
    }
  }

  function stopScan() {
    scannerRef.current?.stop();
    setScanning(false);
  }

  return (
    <div className="space-y-3">
      {scanning ? (
        <Button
          type="button"
          variant="destructive"
          className="h-auto w-full flex-col gap-1 py-4"
          onClick={stopScan}
        >
          <StopCircle className="size-5" />
          <span className="text-sm font-medium">Stop scanning</span>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full flex-col gap-1 py-4"
          onClick={startScan}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <ScanBarcode className="size-5" />
          )}
          <span className="text-sm font-medium">
            {isSubmitting ? "Saving…" : "Scan barcode"}
          </span>
          <span className="text-muted-foreground text-[11px] font-normal">
            Point camera at ISBN barcode
          </span>
        </Button>
      )}

      <video
        ref={videoRef}
        className={`bg-muted h-40 w-full rounded-md object-cover ${
          scanning ? "block" : "hidden"
        }`}
        muted
        playsInline
      />
    </div>
  );
}
