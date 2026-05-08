import Link from "next/link";
import TopBar from "@/components/TopBar";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "About — Carnegie",
};

export default function AboutPage() {
  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          ← Home
        </Link>

        <header className="space-y-2">
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
            About
          </p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Carnegie
          </h1>
          <p className="text-muted-foreground max-w-prose text-balance text-sm">
            A personal-library cataloger. Photograph your shelves, scan
            barcodes, or type ISBNs — Carnegie reads the spines and exports a
            clean LibraryThing CSV.
          </p>
        </header>

        <Card>
          <CardContent className="space-y-4 p-5 text-sm">
            <section className="space-y-1">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                How it works
              </h2>
              <ol className="text-muted-foreground list-decimal space-y-1 pl-5">
                <li>Capture: photo, barcode scan, or manual ISBN entry.</li>
                <li>
                  Read: Claude Sonnet 4.6 reads the spines; ambiguous shots
                  auto-escalate to Opus 4.7.
                </li>
                <li>
                  Look up: ISBNdb, Open Library, and Google Books are queried
                  in parallel; the best fields from each are merged.
                </li>
                <li>Review and confirm. Reject means delete.</li>
                <li>Export to LibraryThing-compatible CSV when ready.</li>
              </ol>
            </section>

            <section className="space-y-1">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                Credits
              </h2>
              <p className="text-muted-foreground">
                Book metadata from ISBNdb, Open Library, and Google Books.
                Vision by Anthropic. Built on Next.js, Drizzle, Neon, and
                Vercel.
              </p>
            </section>

            <section className="space-y-1">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                The name
              </h2>
              <p className="text-muted-foreground">
                After Andrew Carnegie, who funded more than 2,500 free public
                libraries. The tartan on the login screen is the Modern
                Carnegie sett.
              </p>
            </section>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
