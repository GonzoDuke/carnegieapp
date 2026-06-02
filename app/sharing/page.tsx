import Link from "next/link";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { Link2, ShieldCheck } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import ShareLinkBox from "@/components/share/ShareLinkBox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SharingPage() {
  const userId = await requireUserId();
  const db = getDb();
  const [user] = await db
    .select({ shareToken: schema.users.shareToken })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const token = user?.shareToken ?? null;

  // Build the absolute share URL server-side from the request host so the
  // copy box shows a real, sendable link (and ShareLinkBox needs no effect).
  let shareUrl = "";
  if (token) {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    shareUrl = host ? `${proto}://${host}/share/${token}` : `/share/${token}`;
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          ← Home
        </Link>

        <header className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Share your carts
          </h1>
          <p className="text-muted-foreground text-sm">
            Give colleagues a read-only link to browse your carts — the book
            lists and your box photos — without a login. The link isn&apos;t
            searchable; only people you send it to can open it.
          </p>
        </header>

        {token ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-4" />
                Sharing is on
              </div>
              <ShareLinkBox url={shareUrl} path={`/share/${token}`} />
              <p className="text-muted-foreground text-xs">
                Anyone with this link can view all your non-deleted carts,
                read-only. They can&apos;t edit anything or see anything else in
                your account.
              </p>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <form method="POST" action="/api/sharing">
                  <input type="hidden" name="_action" value="regenerate" />
                  <Button type="submit" variant="outline" size="sm">
                    Regenerate link
                  </Button>
                </form>
                <form method="POST" action="/api/sharing">
                  <input type="hidden" name="_action" value="disable" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Turn off sharing
                  </Button>
                </form>
              </div>
              <p className="text-muted-foreground text-xs">
                Regenerating makes the current link stop working — use it to
                revoke access you&apos;ve already shared.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-muted-foreground text-sm">
                Sharing is off. Create a link to let colleagues view your carts.
              </p>
              <form method="POST" action="/api/sharing">
                <input type="hidden" name="_action" value="enable" />
                <Button type="submit" size="sm">
                  <Link2 className="size-4" />
                  Create share link
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
