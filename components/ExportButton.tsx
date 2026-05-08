"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  batchId: string;
  count: number;
};

const LT_IMPORT_URL = "https://www.librarything.com/import.php";

export default function ExportButton({ batchId, count }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (count === 0) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Download className="size-4" />
        Send to LibraryThing (0)
      </Button>
    );
  }

  const csvUrl = `/api/batches/${batchId}/export.csv`;

  function onClick() {
    // Open LibraryThing's import page in a new tab. The current tab handles
    // the CSV download via Content-Disposition: attachment, so the user
    // doesn't navigate away. We rely on this handler running synchronously
    // inside the click gesture so the popup blocker doesn't kill it.
    window.open(LT_IMPORT_URL, "_blank", "noopener,noreferrer");
    // Refresh the page after the download fires so the "Exported" badge
    // updates without requiring a manual reload.
    startTransition(() => {
      // Small delay so the download request hits the server before refresh.
      setTimeout(() => router.refresh(), 500);
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      render={<a href={csvUrl} download onClick={onClick} />}
    >
      <Download className="size-4" />
      Send to LibraryThing ({count})
    </Button>
  );
}
