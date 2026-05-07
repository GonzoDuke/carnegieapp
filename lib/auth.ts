import { cookies } from "next/headers";

export const AUTH_COOKIE = "zp_auth";

export function getExpectedPasscode(): string | null {
  return process.env.APP_PASSCODE ?? null;
}

export async function isAuthenticated(): Promise<boolean> {
  const expected = getExpectedPasscode();
  if (!expected) return false;
  const store = await cookies();
  return store.get(AUTH_COOKIE)?.value === expected;
}
