import Image from "next/image";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
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

        {/* Bookplate plaque hero — tartan binding with a cream nameplate
            affixed on top. The BrandMark + wordmark sit inside the plate,
            with an "Ex Libris" caption that ties back to the login screen. */}
        <section className="relative overflow-hidden rounded-2xl border shadow-sm">
          <div className="relative h-36 w-full sm:h-40">
            <Image
              src="/tartanImagePrototype.jpg"
              alt=""
              fill
              priority
              sizes="(max-width: 768px) 100vw, 672px"
              className="object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="bg-card/95 ring-primary/30 flex items-center gap-3 rounded-md px-5 py-3 shadow-md ring-1 backdrop-blur-sm">
                <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
                  <BrandMark className="size-7" />
                </span>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-[0.25em]">
                    Ex Libris
                  </span>
                  <span className="font-heading text-2xl font-semibold leading-none tracking-tight">
                    Carnegie
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <p className="text-muted-foreground max-w-prose text-balance text-sm">
          A personal-library cataloger. Photograph your shelves, scan
          barcodes, or type ISBNs — Carnegie reads the spines and exports a
          clean LibraryThing CSV.
        </p>

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
                libraries. The tartan above is the Modern Carnegie sett.
              </p>
            </section>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
