"use client";

import { useEffect, useRef } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

type Props = {
  /** Called on each successful barcode decode. */
  onScan: (code: string) => void;
  /** Called if the camera fails to start (permissions, no device, etc.). */
  onError?: (message: string) => void;
  /**
   * When false (default), the camera stops after the first successful scan.
   * When true, decoding continues and onScan fires repeatedly — caller
   * controls when to unmount.
   */
  continuous?: boolean;
  /**
   * Suppress consecutive identical scans within this window (ms). Zxing
   * fires repeatedly while a barcode stays in frame; ignoring duplicates
   * prevents one barcode from filling N rows in continuous mode.
   */
  dedupeWindowMs?: number;
  className?: string;
};

/**
 * Thin wrapper around @zxing/browser's BrowserMultiFormatReader. Owns the
 * camera lifecycle (start on mount, stop on unmount) and the
 * consecutive-duplicate dedupe. Callers handle UX (overlay, tally, close
 * button) and decide what to do with each scanned code.
 */
export default function BarcodeReader({
  onScan,
  onError,
  continuous = false,
  dedupeWindowMs = 1500,
  className,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null);

  // Stash callbacks in refs so the camera-mount effect doesn't restart on
  // every parent re-render (which would tear down and re-init the
  // camera). Latest callback wins per scan.
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const reader = new BrowserMultiFormatReader();
    let alive = true;

    reader
      .decodeFromVideoDevice(undefined, videoEl, (result, _err, controls) => {
        controlsRef.current = controls;
        if (!alive || !result) return;
        const code = result.getText();
        const now = Date.now();
        const last = lastScanRef.current;
        if (last && last.code === code && now - last.ts < dedupeWindowMs) return;
        lastScanRef.current = { code, ts: now };
        onScanRef.current(code);
        if (!continuous) {
          alive = false;
          controls.stop();
        }
      })
      .catch((err) => {
        if (!alive) return;
        onErrorRef.current?.(
          err instanceof Error ? err.message : String(err),
        );
      });

    return () => {
      alive = false;
      controlsRef.current?.stop();
    };
  }, [continuous, dedupeWindowMs]);

  return (
    <video
      ref={videoRef}
      className={className ?? "bg-muted h-40 w-full rounded-md object-cover"}
      muted
      playsInline
    />
  );
}
