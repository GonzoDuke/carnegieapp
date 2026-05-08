import Image from "next/image";
import { Library } from "lucide-react";
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
  setup?: string;
  error?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { next, setup, error } = await searchParams;

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
          <p className="text-muted-foreground mt-0.5 text-[10px] font-medium uppercase tracking-[0.25em]">
            Ex Libris
          </p>
          <CardDescription className="mt-2">
            Enter your passcode to continue.
          </CardDescription>
        </CardHeader>

        <form method="POST" action="/api/login">
          <CardContent className="space-y-4 px-6">
            {setup && (
              <Alert variant="destructive">
                <AlertDescription>
                  APP_PASSCODE is not set on the server. Add it to .env.local before
                  logging in.
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
