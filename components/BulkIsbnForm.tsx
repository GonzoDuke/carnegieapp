"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Props = {
  batchId: string;
};

// Pull ISBNs out of a free-form blob — one per line is the documented
// happy path, but we also split on commas, semicolons, and runs of
// whitespace so a pasted column or a space-separated list both work. A
// token counts as an ISBN when, stripped of hyphens/spaces, it's 10 chars
// (digits + optional trailing X check digit) or 13 digits. Duplicates
// inside the paste are dropped; the server still re-validates each one and
// runs the same lookup chain a single manual entry would.
function parseIsbns(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const digits = trimmed.replace(/[\s-]/g, "");
    if (!/^\d{9}[\dXx]$|^\d{13}$/.test(digits)) continue;
    const key = digits.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(digits);
  }
  return out;
}

// Each ISBN runs the full server-side lookup chain (5–25s worst case), so we
// fire a few at once rather than strictly one-at-a-time — but keep the pool
// small to stay friendly to the upstream lookup providers.
const CONCURRENCY = 4;

export default function BulkIsbnForm({ batchId }: Props) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const parsedCount = busy ? 0 : parseIsbns(raw).length;

  async function addOne(isbn: string): Promise<"hit" | "miss" | "error"> {
    try {
      const res = await fetch(`/api/batches/${batchId}/books`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ isbn }),
      });
      if (!res.ok) return "error";
      const payload = (await res.json().catch(() => null)) as {
        lookup?: unknown;
      } | null;
      // A null lookup means the chain missed — the book is still created, but
      // it lands in pending review for the user to fix up.
      return payload?.lookup ? "hit" : "miss";
    } catch {
      return "error";
    } finally {
      setDone((n) => n + 1);
    }
  }

  async function handleAdd() {
    const isbns = parseIsbns(raw);
    if (isbns.length === 0) {
      toast.error("No valid ISBNs found.", {
        description: "Enter one ISBN per line (10 or 13 digits each).",
      });
      return;
    }

    setBusy(true);
    setDone(0);
    setTotal(isbns.length);
    const toastId = toast.loading(`Adding ${isbns.length} books…`, {
      description: "Running the lookup for each ISBN. Keep this page open.",
    });

    let hits = 0;
    let misses = 0;
    let errors = 0;

    // Bounded worker pool: shared cursor, CONCURRENCY workers pulling from it.
    let cursor = 0;
    const worker = async () => {
      while (cursor < isbns.length) {
        const index = cursor;
        cursor += 1;
        const result = await addOne(isbns[index]);
        if (result === "hit") hits += 1;
        else if (result === "miss") misses += 1;
        else errors += 1;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, isbns.length) }, worker),
    );

    setBusy(false);
    // Pull the freshly-created books into the list below.
    router.refresh();

    const added = hits + misses;
    const parts: string[] = [`${hits} matched`];
    if (misses > 0) parts.push(`${misses} need review`);
    if (errors > 0) parts.push(`${errors} failed`);
    const finish = errors > 0 && added === 0 ? toast.error : toast.success;
    finish(`Added ${added} of ${isbns.length} books`, {
      id: toastId,
      description: parts.join(" · "),
    });
    // Keep failed input around so the user can retry; clear on a clean run.
    if (errors === 0) setRaw("");
  }

  return (
    <details className="group border-t pt-3">
      <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        Have a stack? Add several ISBNs at once
      </summary>
      <div className="mt-3 space-y-2">
        <Label htmlFor="bulk-isbns">ISBNs — one per line</Label>
        <Textarea
          id="bulk-isbns"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"9780143127741\n9780307279460\n9781400079988"}
          rows={5}
          inputMode="numeric"
          disabled={busy}
          className="font-mono text-sm"
        />
        <p className="text-muted-foreground text-xs">
          {busy
            ? `Adding ${done} of ${total}…`
            : parsedCount > 0
              ? `${parsedCount} ISBN${parsedCount === 1 ? "" : "s"} ready to add`
              : "Paste or type a list — each ISBN becomes a book in this batch."}
        </p>
        <Button
          type="button"
          onClick={handleAdd}
          disabled={busy || parsedCount === 0}
          className="w-full"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ListPlus className="size-4" />
          )}
          {busy ? `Adding ${done} of ${total}…` : "Add all"}
        </Button>
      </div>
    </details>
  );
}
