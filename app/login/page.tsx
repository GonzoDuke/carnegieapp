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
import { CarnegieMark } from "@/components/CarnegieMark";

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
      <Card className="relative w-full max-w-sm overflow-hidden pt-2">
        {/* Tartan headband across the top of the card — matching the
            colored fabric headband on a bound book's spine. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5"
          style={{
            backgroundImage: "url(/tartan.svg)",
            backgroundSize: "96px 96px",
            backgroundRepeat: "repeat-x",
          }}
        />

        <CardHeader className="items-center pt-4 text-center">
          <CarnegieMark size={56} />
          <CardTitle className="font-heading mt-3 text-3xl tracking-tight">
            Carnegie
          </CardTitle>
          <p className="text-muted-foreground mt-0.5 text-[10px] font-medium uppercase tracking-[0.25em]">
            Ex Libris
          </p>
          <CardDescription className="mt-2">
            Enter your passcode to continue.
          </CardDescription>
        </CardHeader>

        <form method="POST" action="/api/login">
          <CardContent className="space-y-4">
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

          <CardFooter>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
