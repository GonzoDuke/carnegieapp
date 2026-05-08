import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";

export default function TopBar() {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="text-foreground hover:text-primary group flex items-center gap-2.5 transition-colors"
        >
          {/* Tartan chip — small textile sample beside the wordmark.
              40×28 is large enough that several stripes of the sett are
              visible (no thin-strip ambiguity). Bookplate-frame ring
              keeps the chip readable against the bar. */}
          <span
            aria-hidden="true"
            className="ring-foreground/10 inline-block h-7 w-10 shrink-0 rounded-md ring-1 transition-transform group-hover:-rotate-1"
            style={{
              backgroundImage: "url(/tartanImagePrototype.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <span className="font-heading text-lg font-semibold tracking-tight">
            Carnegie
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <ThemeToggle />
          <form method="POST" action="/api/logout">
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              title="Log out"
              className="text-muted-foreground"
            >
              <LogOut className="size-4" />
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
