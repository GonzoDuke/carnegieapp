import Link from "next/link";
import { eq } from "drizzle-orm";
import { Info, LogOut } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { getCurrentUserId } from "@/lib/auth";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import SearchBar from "@/components/SearchBar";

// One small DB lookup per render — Neon HTTP makes that ~10ms. Returns
// null on the login page (no session) so we render TopBar without the
// user chip rather than crashing.
async function loadCurrentUserName(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const db = getDb();
  const [user] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.name ?? null;
}

export default async function TopBar() {
  const userName = await loadCurrentUserName();
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="text-foreground hover:text-primary group flex items-center gap-2.5 transition-colors"
        >
          {/* Tartan-backed chip — the books float in front of a piece of
              Modern Carnegie tartan. At 44px the sett reads clearly as
              fabric. White fill + drop-shadow keeps the books readable
              regardless of which stripe is behind them. The 1px gold ring
              frames it like a bookplate. */}
          <span
            className="ring-primary/40 relative flex size-11 items-center justify-center overflow-hidden rounded-md ring-1 transition-transform group-hover:rotate-2"
            style={{
              backgroundImage: "url(/tartanImagePrototype.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <BrandMark className="size-7 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" />
          </span>
          <span className="font-heading text-2xl font-semibold tracking-tight">
            Carnegie
          </span>
        </Link>

        <SearchBar />

        <nav className="flex items-center gap-1">
          {userName && (
            <span
              className="text-muted-foreground hidden max-w-[120px] truncate px-1.5 text-sm sm:inline"
              title={`Signed in as ${userName}`}
            >
              {userName}
            </span>
          )}
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
