import Link from "next/link";
import { Info, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import SearchBar from "@/components/SearchBar";

// Reusable book-stack mark from public/icon.svg, inlined so it picks up
// currentColor for theming. Sized small for header use.
function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="120" y="120" width="60" height="272" rx="6" />
      <rect x="200" y="160" width="56" height="232" rx="6" />
      <rect
        x="276"
        y="100"
        width="52"
        height="292"
        rx="6"
        transform="rotate(6 302 246)"
      />
      <rect
        x="350"
        y="140"
        width="48"
        height="252"
        rx="6"
        transform="rotate(-4 374 266)"
      />
      <rect x="96" y="396" width="320" height="20" rx="4" />
    </svg>
  );
}

export default function TopBar() {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="text-foreground hover:text-primary group flex items-center gap-2 transition-colors"
        >
          <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-md transition-transform group-hover:rotate-2">
            <BrandMark className="size-5" />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">
            Carnegie
          </span>
        </Link>

        <SearchBar />

        <nav className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="About Carnegie"
            className="text-muted-foreground"
            render={<Link href="/about" />}
          >
            <Info className="size-4" />
          </Button>
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
