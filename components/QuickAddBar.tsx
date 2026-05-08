"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

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
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Label htmlFor="quick-add-isbn" className="text-[11px] font-medium uppercase tracking-wider">
              Quick add ISBN
            </Label>
            <Input
              id="quick-add-isbn"
              type="text"
              name="isbn"
              placeholder="ISBN-10 or ISBN-13 (hyphens OK)"
              maxLength={20}
              required
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-add-batch" className="text-[11px] font-medium uppercase tracking-wider">
              Batch
            </Label>
            <select
              id="quick-add-batch"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="border-input bg-background ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-44 rounded-md border px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
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
    </Card>
  );
}
