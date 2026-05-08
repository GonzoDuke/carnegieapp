import Image from "next/image";
import { count } from "drizzle-orm";
import { Library } from "lucide-react";
import { getDb, schema } from "@/lib/db/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SearchParams = Promise<{
  next?: string;
  error?: string;
}>;

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { next, error } = await searchParams;

  // If no users have been seeded yet, surface that explicitly — the user
  // landed here without anyone to log in as.
  const db = getDb();
  const [{ n: userCount }] = await db
    .select({ n: count() })
    .from(schema.users);
  const noUsers = userCount === 0;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="relative w-full max-w-sm overflow-hidden p-0">
        {/* Tartan banner — substantial enough that the woven sett actually
            reads as fabric (not as a thin strip of unidentifiable color).
            object-cover + cropped height keeps a clean, intentional band. */}
        <div className="relative h-32 w-full">
          <Image
            src="/tartanImagePrototype.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 640px) 100vw, 384px"
            className="object-cover"
          />
        </div>

        <CardHeader className="items-center px-6 pt-6 text-center">
          <div className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-full">
            <Library className="size-6" />
          </div>
          <CardTitle className="mt-2 text-2xl tracking-tight">Carnegie</CardTitle>
          <CardDescription className="mt-2">
            Enter your passcode to continue.
          </CardDescription>
        </CardHeader>

        <form method="POST" action="/api/login">
          <CardContent className="space-y-4 px-6">
            {noUsers && (
              <Alert variant="destructive">
                <AlertDescription>
                  No users have been created yet. Run{" "}
                  <code>node scripts/migrate-multitenant.mjs</code> to seed the
                  default user from APP_PASSCODE.
                </AlertDescription>
              </Alert>
            )}
            {error === "invalid" && (
              <Alert variant="destructive">
                <AlertDescription>Incorrect passcode.</AlertDescription>
              </Alert>
            )}

            <input type="hidden" name="next" value={next ?? "/"} />
            <div className="grid gap-2">
              <Label htmlFor="passcode">Passcode</Label>
              <Input
                id="passcode"
                type="password"
                name="passcode"
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
          </CardContent>

          <CardFooter className="px-6 pb-6">
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
