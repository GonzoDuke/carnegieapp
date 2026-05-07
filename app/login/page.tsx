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
      <form
        method="POST"
        action="/api/login"
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
      >
        <div>
          <h1 className="text-xl font-semibold">Zippy Planet</h1>
          <p className="mt-1 text-sm text-zinc-500">Enter passcode to continue.</p>
        </div>

        {setup && (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            APP_PASSCODE is not set on the server. Add it to .env.local before logging in.
          </p>
        )}
        {error === "invalid" && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            Incorrect passcode.
          </p>
        )}

        <input type="hidden" name="next" value={next ?? "/"} />
        <input
          type="password"
          name="passcode"
          autoComplete="current-password"
          required
          autoFocus
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
