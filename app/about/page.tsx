import Image from "next/image";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import TopBar from "@/components/TopBar";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "About — Carnegie",
};

const STEPS: { title: string; body: string }[] = [
  {
    title: "Capture",
    body: "Photograph a shelf, scan a barcode, or type an ISBN. Whichever input the moment allows.",
  },
  {
    title: "Read",
    body: "Claude Sonnet 4.6 reads the spines. Ambiguous photos auto-escalate to Opus 4.7 — slower and pricier, but more accurate when the book deserves it.",
  },
  {
    title: "Look up",
    body: "ISBNdb, Open Library, and Google Books are queried in parallel; the best fields from each are merged onto the winner.",
  },
  {
    title: "Confirm",
    body: "Two clicks per book — one to confirm a real match, one to delete a misread. The pending queue surfaces the lowest-confidence reads first.",
  },
  {
    title: "Export",
    body: "Confirmed books download as a LibraryThing-compatible CSV when the batch is ready to ship.",
  },
];

export default function AboutPage() {
  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-2xl space-y-10 px-4 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
        >
          ← Home
        </Link>

        {/* Bookplate plaque hero — taller now (160–176px), with a more
            substantial nameplate on top of the tartan binding. The plate
            is wider and the wordmark larger so this surface carries the
            weight of an identity statement, not just a header. */}
        <section className="relative overflow-hidden rounded-2xl border shadow-sm">
          <div className="relative h-40 w-full sm:h-44">
            <Image
              src="/tartanImagePrototype.jpg"
              alt=""
              fill
              priority
              sizes="(max-width: 768px) 100vw, 672px"
              className="object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="bg-card/95 ring-primary/30 flex items-center gap-4 rounded-md px-6 py-4 shadow-md ring-1 backdrop-blur-sm">
                <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-md">
                  <BrandMark className="size-8" />
                </span>
                <span className="font-heading text-3xl font-semibold leading-none tracking-tight sm:text-4xl">
                  Carnegie
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Epigraph — Andrew Carnegie's actual line about libraries.
            Sets the tone before any product copy: this is a tool in
            service of a real idea. */}
        <blockquote className="space-y-3 px-4 text-center">
          <p className="font-heading text-balance text-xl italic leading-relaxed text-foreground/90 sm:text-2xl">
            “A library outranks any other one thing a community can do to
            benefit its people.”
          </p>
          <footer className="text-muted-foreground text-sm uppercase tracking-[0.2em]">
            — Andrew Carnegie
          </footer>
        </blockquote>

        <p className="text-foreground text-lg leading-relaxed">
          A personal-library cataloger. Photograph your shelves, scan
          barcodes, or type ISBNs — Carnegie reads the spines, looks up
          the metadata, and walks you out the other side with a clean
          LibraryThing-compatible CSV.
        </p>

        <section className="space-y-4">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            How it works
          </h2>
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <Card>
                  <CardContent className="flex items-start gap-4 p-5">
                    <span className="bg-primary/10 text-primary ring-primary/20 font-heading flex size-10 shrink-0 items-center justify-center rounded-md text-lg font-semibold tabular-nums ring-1">
                      {i + 1}
                    </span>
                    <div className="min-w-0 space-y-1.5">
                      <h3 className="font-heading text-lg font-semibold leading-snug">
                        {step.title}
                      </h3>
                      <p className="text-muted-foreground text-base leading-relaxed">
                        {step.body}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-4">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Colophon
          </h2>
          <Card>
            <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
              <ColophonGroup label="Data">
                <li>ISBNdb</li>
                <li>Open Library</li>
                <li>Google Books</li>
              </ColophonGroup>
              <ColophonGroup label="Vision">
                <li>Claude Sonnet 4.6</li>
                <li>Claude Opus 4.7</li>
              </ColophonGroup>
              <ColophonGroup label="Built with">
                <li>Next.js · Drizzle</li>
                <li>Neon · Vercel</li>
                <li>Lora · Geist Sans</li>
              </ColophonGroup>
            </CardContent>
          </Card>
        </section>

        <p className="text-muted-foreground text-center text-sm">
          Need a quick reference? See the{" "}
          <Link
            href="/guide"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Guide
          </Link>
          .
        </p>
      </main>
    </>
  );
}

function ColophonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-[0.22em]">
        {label}
      </h3>
      <ul className="text-foreground space-y-1 text-base">{children}</ul>
    </div>
  );
}
