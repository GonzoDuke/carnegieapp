"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Attempt = {
  source: string;
  result: unknown | null;
  error?: string;
};

type Outcome = {
  isbn: { isbn13: string | null; isbn10: string | null };
  result: {
    source: string;
    title: string;
    authors: string[];
    publisher: string | null;
    pubDate: string | null;
    isbn13: string | null;
    isbn10: string | null;
  } | null;
  attempts: Attempt[];
};

export default function LookupDebugPage() {
  const [isbn, setIsbn] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOutcome(null);

    try {
      const res = await fetch("/api/lookup/isbn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isbn }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || `Request failed (${res.status})`);
        if (json?.attempts || json?.isbn) {
          setOutcome({
            isbn: json.isbn ?? { isbn13: null, isbn10: null },
            result: null,
            attempts: json.attempts ?? [],
          });
        }
        return;
      }
      setOutcome(json as Outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Lookup debug
        </h1>
        <p className="text-muted-foreground text-sm">
          Test an ISBN against the lookup chain (ISBNdb → Open Library / Google Books).
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="isbn">ISBN</Label>
              <Input
                id="isbn"
                type="text"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                required
                placeholder="ISBN-10 or ISBN-13 (hyphens OK)"
              />
            </div>
            <Button type="submit" disabled={loading}>
              <Search className="size-4" />
              {loading ? "Looking up…" : "Lookup"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="text-destructive py-3 text-sm">{error}</CardContent>
        </Card>
      )}

      {outcome && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardDescription className="text-xs uppercase tracking-wider">
                Normalized
              </CardDescription>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div>ISBN-13: {outcome.isbn.isbn13 ?? "—"}</div>
                <div>ISBN-10: {outcome.isbn.isbn10 ?? "—"}</div>
              </div>
            </CardHeader>
          </Card>

          {outcome.result ? (
            <Card className="border-primary/40">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs uppercase tracking-wider">
                    Match
                  </CardDescription>
                  <Badge>{outcome.result.source}</Badge>
                </div>
                <CardTitle className="text-base">{outcome.result.title}</CardTitle>
                <CardDescription>
                  {outcome.result.authors.join(" / ") || "Unknown author"}
                  {outcome.result.publisher && ` · ${outcome.result.publisher}`}
                  {outcome.result.pubDate && ` · ${outcome.result.pubDate}`}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-3 text-sm">
                No acceptable match across providers.
              </CardContent>
            </Card>
          )}

          <details className="group">
            <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium">
              Provider attempts ({outcome.attempts.length})
            </summary>
            <Card className="mt-2">
              <CardContent className="pt-4">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug">
                  {JSON.stringify(outcome.attempts, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </details>
        </div>
      )}
    </main>
  );
}
