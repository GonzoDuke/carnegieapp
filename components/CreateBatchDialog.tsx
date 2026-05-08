"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CreateBatchDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        New batch
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form method="POST" action="/api/batches">
          <DialogHeader>
            <DialogTitle>New batch</DialogTitle>
            <DialogDescription>
              Group of books from one shelf, box, or stack.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                placeholder="e.g. Box 4"
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="location">
                Location <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="location"
                name="location"
                placeholder="e.g. Garage"
                maxLength={200}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">
                Notes <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="notes"
                name="notes"
                placeholder="Anything else worth remembering"
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Create batch</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
