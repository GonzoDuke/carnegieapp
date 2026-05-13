import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  ScanBarcode,
  Pencil,
  Sparkles,
  CheckCheck,
  X,
} from "lucide-react";
import TopBar from "@/components/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { FEEDBACK_MAILTO } from "@/lib/feedback";

export const metadata = {
  title: "Guide — Carnegie",
};

export default function GuidePage() {
  return (
    <>
      <TopBar />

      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeft className="size-3" />
          Home
        </Link>

        <header className="space-y-1.5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Guide
          </h1>
          <p className="text-muted-foreground text-sm">Quick reference.</p>
        </header>

        {/* Three workflows, one card each. Each card is icon + name + one
            sentence + the where-to-find-it nudge. Scannable in one pass. */}
        <section className="space-y-3">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Three ways to add books
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <WayCard
              icon={<Camera className="size-5" />}
              label="Photo a shelf"
              body="Best for 15–25 books at a time."
              hint="Batch page → Photo"
            />
            <WayCard
              icon={<ScanBarcode className="size-5" />}
              label="Scan barcode"
              body="Best when you have the book in hand."
              hint="Batch page → Scan, or Quick-fill"
            />
            <WayCard
              icon={<Pencil className="size-5" />}
              label="Type ISBN / title"
              body="Best for older books without barcodes."
              hint="Home → Quick add, or Batch → Manual"
            />
          </div>
        </section>

        {/* Step-by-step for each workflow. Compact numbered lists, no
            prose, no second-person prefaces. Reads like a printed
            cheat-card. */}
        <section className="space-y-5">
          <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            How each workflow goes
          </h2>

          <Workflow
            title="Photograph a shelf"
            steps={[
              "Home → New batch. Name it (e.g. living room top).",
              "Batch page → Take photo or From library.",
              "Tap Analyze. 15–30 seconds.",
              "Books land in the Needs review queue.",
              "Quick-fill ISBNs (top of batch) handles the ones missing ISBN.",
              "Tap Send to LibraryThing when all rows look right.",
            ]}
          />

          <Workflow
            title="Scan barcodes (stack of books in hand)"
            steps={[
              "Open the batch's Quick-fill ISBNs page.",
              "Tap Scan barcodes. The camera opens fullscreen.",
              "Point at each book's back-cover barcode in turn.",
              "Each scan auto-fills the next empty row. Skip lets you pass.",
              "Tap Done, then Fill at the bottom to run all lookups.",
            ]}
          />

          <Workflow
            title="Type a single ISBN"
            steps={[
              "Home → Quick add → type or scan the ISBN.",
              "Pick a batch (or create a new one).",
              "Tap Add. Book lands in the batch immediately.",
            ]}
          />
        </section>

        {/* Key concepts — the small handful of behaviors that aren't
            obvious from the UI alone. Listed once, terse. */}
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            Worth knowing
          </h2>
          <Card>
            <CardContent className="space-y-3 p-5 text-sm">
              <Fact
                label="Your ISBN wins"
                body="An ISBN you type or scan is authoritative. The lookup chain fills metadata around it — it never overwrites the ISBN with a different edition."
              />
              <Fact
                label="Vision is ~97% accurate"
                body="Expect one or two odd reads per shelf. The review queue is where you catch them. Bulk-confirm sweeps the high-confidence ones."
              />
              <Fact
                label="Daily cap of 200 photos"
                body="Per user, per UTC day. Plenty for normal use; ask if you need more."
              />
              <Fact
                label="Batches are private"
                body="Even on a shared install, you only see your own batches."
              />
              <Fact
                label="Photos under ~4 MB raw"
                body="The in-app camera compresses automatically. Uploads from your photo library may need resizing if they're huge."
              />
            </CardContent>
          </Card>
        </section>

        {/* Review actions cheat-card. Single icon-button-and-meaning list
            instead of prose. */}
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            Review actions
          </h2>
          <Card>
            <CardContent className="grid gap-2 p-5 text-sm sm:grid-cols-2">
              <ActionRow
                icon={<CheckCheck className="size-4" />}
                name="Confirm"
                meaning="Title and author look right. Sends to confirmed."
              />
              <ActionRow
                icon={<Pencil className="size-4" />}
                name="Edit"
                meaning="Open the card and fix any field. Save to commit."
              />
              <ActionRow
                icon={<Sparkles className="size-4" />}
                name="Re-lookup"
                meaning="Re-runs the chain. Use after typing an ISBN."
              />
              <ActionRow
                icon={<X className="size-4" />}
                name="Reject"
                meaning="Not a real book, or misread is unrecoverable."
              />
            </CardContent>
          </Card>
        </section>

        {/* Troubleshooting table-ish layout. Symptom on the left,
            action on the right. Two columns from sm: up; stacks on
            phone. */}
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            If something looks wrong
          </h2>
          <p className="text-muted-foreground text-sm">
            Stuck or seeing something unexpected?{" "}
            <a
              href={FEEDBACK_MAILTO}
              className="text-foreground underline underline-offset-2 hover:text-primary"
            >
              Email Jonathan
            </a>{" "}
            with the batch name and a screenshot. Common cases below.
          </p>
          <Card>
            <CardContent className="divide-y p-0 text-sm">
              <Trouble
                symptom="Wrong book in a row"
                action="Open the card, fix the ISBN, tap Re-lookup."
              />
              <Trouble
                symptom="Right book but wrong cover/publisher"
                action="That's usually a lookup-edition mismatch. Re-lookup with the exact ISBN from the back cover."
              />
              <Trouble
                symptom="A book on the shelf wasn't extracted"
                action="Use Manual or Quick add to enter it by ISBN."
              />
              <Trouble
                symptom="Photo upload says image too large"
                action="Use the in-app camera (auto-compresses), or save your photo smaller."
              />
              <Trouble
                symptom="Stuck spinner / weird duplicate rows"
                action="Refresh the page. If it persists, message the operator with the batch name and time."
              />
            </CardContent>
          </Card>
        </section>
      </main>
    </>
  );
}

function WayCard({
  icon,
  label,
  body,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  body: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
          {icon}
        </div>
        <h3 className="font-heading text-base font-semibold leading-tight">
          {label}
        </h3>
        <p className="text-muted-foreground text-sm leading-snug">{body}</p>
        <p className="text-muted-foreground/80 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Workflow({
  title,
  steps,
}: {
  title: string;
  steps: string[];
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="font-heading text-base font-semibold">{title}</h3>
        <ol className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-primary/80 tabular-nums">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function Fact({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <span className="text-foreground sm:w-44 sm:shrink-0 font-medium">
        {label}
      </span>
      <span className="text-muted-foreground">{body}</span>
    </div>
  );
}

function ActionRow({
  icon,
  name,
  meaning,
}: {
  icon: React.ReactNode;
  name: string;
  meaning: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="bg-muted text-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground"> — {meaning}</span>
      </div>
    </div>
  );
}

function Trouble({ symptom, action }: { symptom: string; action: string }) {
  return (
    <div className="grid gap-1 p-4 sm:grid-cols-[1fr_2fr] sm:gap-4">
      <span className="text-foreground font-medium">{symptom}</span>
      <span className="text-muted-foreground">{action}</span>
    </div>
  );
}
