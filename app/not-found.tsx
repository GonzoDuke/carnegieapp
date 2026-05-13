import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-8 text-center">
          <div className="bg-muted text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-full">
            <BookOpen className="size-6" />
          </div>
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Off the shelf
            </h1>
            <p className="text-muted-foreground text-sm">
              That page isn&apos;t in Carnegie. Maybe the URL is off, or a batch
              was deleted.
            </p>
          </div>
          <Link
            href="/"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
