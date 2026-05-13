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

  async function deleteBatch() {
    const noun = bookCount === 1 ? "book" : "books";
    const ok = window.confirm(
      `Delete batch "${batchName}" and all ${bookCount} ${noun}? This cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
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
