import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import { CarnegieMark } from "@/components/CarnegieMark";

export default function TopBar() {
  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/65 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="text-foreground hover:text-primary group flex items-center gap-2 transition-colors"
        >
          <span className="transition-transform group-hover:-rotate-1">
            <CarnegieMark size={28} />
          </span>
          <span className="font-heading text-xl font-semibold tracking-tight">
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
      {/* Tartan signature strip — present on every page below the bar.
          Permanent identity cue, calm at 2px. */}
      <div
        aria-hidden="true"
        className="h-[3px] w-full"
        style={{
          backgroundImage: "url(/tartan.svg)",
          backgroundSize: "96px 96px",
          backgroundRepeat: "repeat-x",
        }}
      />
    </header>
  );
}
