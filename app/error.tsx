"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-8 text-center">
          <div className="bg-destructive/10 text-destructive mx-auto flex size-12 items-center justify-center rounded-full">
            <AlertTriangle className="size-6" />
          </div>
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Something went sideways
            </h1>
            <p className="text-muted-foreground text-sm">
              Carnegie hit an unexpected error. Try again, or head back home.
              If it keeps happening, screenshot this page and send it to Joe.
            </p>
            {error.digest && (
              <p className="text-muted-foreground/70 font-mono text-[11px]">
                Ref: {error.digest}
              </p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ArrowLeft className="size-4" />
              Home
            </Link>
            <Button size="sm" onClick={reset}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
