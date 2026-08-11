import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

type Props = {
  batchId: string;
  count: number;
};

// A plain download link — no client JS, no side effects. Downloading the
// CSV is a pure read now (see the export.csv route), so there's nothing to
// refresh afterwards and nothing to keep in sync.
//
// This used to also pop open LibraryThing's import page. LibraryThing is
// one destination for the CSV, not the only one, and opening a third-party
// tab on every export was presumptuous — the Guide explains the import
// step for people who want it.
export default function ExportButton({ batchId, count }: Props) {
  // Hide entirely when there's nothing to export. Showing a disabled
  // button just adds noise to the hero header — the user knows they
  // can't export 0 books.
  if (count === 0) return null;

  return (
    <a
      href={`/api/batches/${batchId}/export.csv`}
      download
      className={buttonVariants({ variant: "outline", size: "sm" })}
      title={`Download ${count} confirmed ${count === 1 ? "book" : "books"} as CSV`}
    >
      <Download className="size-4" />
      Download CSV ({count})
    </a>
  );
}
