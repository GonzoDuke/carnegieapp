"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  batchId: string;
  eligibleCount: number;
  threshold: number;
};

export default function BulkConfirmButton({
  batchId,
  eligibleCount,
  threshold,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (eligibleCount === 0) return null;

  async function onClick() {
    const ok = window.confirm(
      `Confirm all ${eligibleCount} pending books with confidence ≥ ${threshold}?`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/books/bulk-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minConfidence: threshold }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || `Failed (${res.status})`);
      }
      const n = payload?.confirmed ?? 0;
      toast.success(`Confirmed ${n} ${n === 1 ? "book" : "books"}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="sm" onClick={onClick} disabled={busy}>
      <CheckCheck className="size-4" />
      {busy ? "Confirming…" : `Confirm ${eligibleCount}`}
    </Button>
  );
}
