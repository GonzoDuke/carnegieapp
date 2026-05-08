"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  batchId: string;
  batchName: string;
  bookCount: number;
};

export default function DeleteBatchButton({ batchId, batchName, bookCount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const noun = bookCount === 1 ? "book" : "books";
    const ok = window.confirm(
      `Delete batch "${batchName}" and all ${bookCount} ${noun}? This cannot be undone.`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `Delete failed (${res.status})`);
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      onClick={onClick}
      disabled={busy}
    >
      <Trash2 className="size-4" />
      {busy ? "Deleting…" : "Delete"}
    </Button>
  );
}
