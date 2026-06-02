"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";

type Props = {
  /** Absolute URL to display and copy (built server-side from the request
   *  host so it's correct on any deploy). */
  url: string;
  /** App-relative path for the "Open" link, e.g. /share/<token>. */
  path: string;
};

export default function ShareLinkBox({ url, path }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Public share link"
        className="border-input bg-muted/40 h-9 w-full min-w-0 flex-1 rounded-md border px-2.5 text-sm"
      />
      <div className="flex gap-2">
        <Button type="button" onClick={copy} variant="outline" size="sm">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ExternalLink className="size-4" />
          Open
        </a>
      </div>
    </div>
  );
}
