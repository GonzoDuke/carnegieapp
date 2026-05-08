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
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-full">
            <Library className="size-6" />
          </div>
          <CardTitle className="mt-2 text-2xl tracking-tight">Carnegie</CardTitle>
          <CardDescription>Enter your passcode to continue.</CardDescription>
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
