"use client";

import { useState } from "react";
import { Plus, ScanBarcode, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import BarcodeReader from "@/components/BarcodeReader";

type Batch = {
  id: string;
  name: string;
  location: string | null;
};

type Props = {
  batches: Batch[];
};

// Lightweight ISBN-and-go form. Tracks the selected batch id in state so we
// can compute the form action URL dynamically and submit straight to the
// existing /api/batches/[id]/books endpoint — same path the manual-entry
// form uses, no new backend route needed.
export default function QuickAddBar({ batches }: Props) {
  const [batchId, setBatchId] = useState<string>(batches[0]?.id ?? "");
  const [isbn, setIsbn] = useState("");
  const [scanning, setScanning] = useState(false);

  if (batches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="text-muted-foreground px-4 py-3 text-sm">
          Create a batch to use quick-add — once you have at least one batch,
          this becomes a single-keystroke ISBN entry point.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="px-4 py-3">
        <form
          method="POST"
          action={`/api/batches/${batchId}/books`}
          className="flex flex-wrap items-end gap-2"
        >
          {/* ISBN — full width on phones (w-full forces a flex-wrap break)
              so it isn't squeezed by the 176px batch select. On sm+ it
              reverts to flex-1 and shares the row with batch + button.
              The scan-icon button sits absolute-positioned over the right
              edge of the input so it doesn't consume horizontal space. */}
          <div className="grid w-full min-w-0 gap-1.5 sm:w-auto sm:flex-1">
            <Label htmlFor="quick-add-isbn" className="text-[11px] font-medium uppercase tracking-wider">
              Quick add ISBN
            </Label>
            <div className="relative">
              <Input
                id="quick-add-isbn"
                type="text"
                name="isbn"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="ISBN-10 or ISBN-13 (hyphens OK)"
                maxLength={20}
                required
                autoComplete="off"
                inputMode="numeric"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setScanning(true)}
                title="Scan a barcode"
                aria-label="Scan a barcode"
                className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center px-2.5 transition-colors"
              >
                <ScanBarcode className="size-4" />
              </button>
            </div>
          </div>
          {/* On phones, batch grows to fill the second row alongside Add. */}
          <div className="grid min-w-0 flex-1 gap-1.5 sm:flex-none">
            <Label htmlFor="quick-add-batch" className="text-[11px] font-medium uppercase tracking-wider">
              Batch
            </Label>
            <select
              id="quick-add-batch"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="border-input bg-background ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none sm:w-44"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.location ? ` · ${b.location}` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm">
            <Plus className="size-4" />
            Add
          </Button>
        </form>
      </CardContent>

      {scanning && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between gap-3 p-3 text-white">
            <p className="text-sm font-medium">Scan a barcode</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setScanning(false)}
            >
              <X className="size-4" />
              Cancel
            </Button>
          </div>
          <div className="relative flex-1 overflow-hidden">
            <BarcodeReader
              continuous={false}
              className="h-full w-full object-cover"
              onScan={(code) => {
                // Single-shot: populate the ISBN field and close. User
                // verifies the value (and the batch picker) before hitting
                // Add. We don't auto-submit — scanning a barcode shouldn't
                // commit a book to the wrong batch.
                const digits = code.replace(/[^0-9Xx]/g, "");
                setIsbn(digits || code);
                setScanning(false);
                toast.success(`Captured ${digits || code}`, {
                  description: "Tap Add to save it to the selected batch.",
                });
              }}
              onError={(message) => {
                toast.error(message);
                setScanning(false);
              }}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-24 w-3/4 max-w-sm rounded-md border-2 border-white/60" />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
