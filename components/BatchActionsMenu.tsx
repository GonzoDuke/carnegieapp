"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  batchId: string;
  batchName: string;
  bookCount: number;
};

// Overflow menu for batch-level actions that are infrequent or
// destructive (Refresh, Delete). Pulled out of the hero header so the
// primary actions (Quick-fill, Confirm, Export) own the toolbar.
export default function BatchActionsMenu({
  batchId,
  batchName,
  bookCount,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function undoDelete() {
    const toastId = toast.loading(`Restoring "${batchName}"…`);
    try {
      const res = await fetch(`/api/batches/${batchId}/restore`, {
        method: "POST",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `Restore failed (${res.status})`);
      }
      toast.success(`Restored "${batchName}"`, { id: toastId });
      router.push(`/batches/${batchId}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        id: toastId,
      });
    }
  }

  async function deleteBatch() {
    const noun = bookCount === 1 ? "book" : "books";
    // Delete is now SOFT — confirm copy reflects that. Hard purge
    // happens (manually) operator-side; from the user's perspective
    // the batch is "deleted" with a brief Undo window.
    const ok = window.confirm(
      `Delete batch "${batchName}" and its ${bookCount} ${noun}? You can undo from the toast.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `Delete failed (${res.status})`);
      }
      // Toast first, then navigate. Sonner's toast store survives
      // a soft router.push so the Undo button stays interactive on
      // the home page. Duration is bumped to ~10s since batch
      // delete is more destructive than the per-book reject — we
      // want a real recovery window.
      toast.success(`Deleted "${batchName}"`, {
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => undoDelete(),
        },
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:outline-none"
        aria-label="Batch actions"
      >
        <MoreHorizontal className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" side="bottom">
          <Menu.Popup className="bg-popover text-popover-foreground z-50 min-w-[10rem] overflow-hidden rounded-md border p-1 shadow-md">
            <Menu.Item
              onClick={refresh}
              disabled={deleting}
              className="hover:bg-muted hover:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors"
            >
              <RefreshCw className="size-4" />
              Refresh
            </Menu.Item>
            <Menu.Separator className="bg-border my-1 h-px" />
            <Menu.Item
              onClick={deleteBatch}
              disabled={deleting}
              className="text-destructive hover:bg-destructive/10 data-[highlighted]:bg-destructive/10 relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors"
            >
              <Trash2 className="size-4" />
              {deleting ? "Deleting…" : "Delete batch"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
