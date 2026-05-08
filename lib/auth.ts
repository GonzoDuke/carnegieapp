import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const AUTH_COOKIE = "carnegie_auth";

const SCRYPT_KEY_LEN = 64;

function getAuthSecret(): string {
  const secret = process.env.APP_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "APP_AUTH_SECRET is missing or too short. Generate with `openssl rand -hex 32` and add to env.",
    );
  }
  return secret;
}

// scrypt(passcode, salt) → "salt_hex:hash_hex". Stored verbatim in
// users.passcode_hash. Salt is per-row so two users with the same
// passcode would still hash differently.
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, SCRYPT_KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

// Constant-time compare. Returns false on any malformed stored value
// rather than throwing — we don't want to leak validity through the
// shape of the error path.
export function verifyPasscode(passcode: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LEN) return false;
  const actual = scryptSync(passcode, salt, SCRYPT_KEY_LEN);
  return timingSafeEqual(expected, actual);
}

// Cookie value: `<userId>.<hex hmac of userId>`. The HMAC means the
// proxy can verify the cookie hasn't been tampered with using only the
// server secret — no DB lookup per request.
export function signSession(userId: string): string {
  const sig = createHmac("sha256", getAuthSecret()).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

// Returns the userId iff the signature is valid; returns null otherwise.
// Pure (no DB). Constant-time signature compare.
export function verifySession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const idx = cookieValue.lastIndexOf(".");
  if (idx <= 0) return null;
  const userId = cookieValue.slice(0, idx);
  const providedSig = cookieValue.slice(idx + 1);
  if (!userId || !providedSig) return null;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(
      createHmac("sha256", getAuthSecret()).update(userId).digest("hex"),
      "hex",
    );
    actual = Buffer.from(providedSig, "hex");
  } catch {
    return null;
  }
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? userId : null;
}

export async function getCurrentUserId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(AUTH_COOKIE)?.value;
  return verifySession(value);
}

// Pages and route handlers call this at the top to gate on auth and
// pull the current user id out for filtering. Throws a Next redirect
// to /login when the cookie is missing or invalid — the proxy already
// gates entry, but request handlers can still be hit directly so this
// is the belt-and-suspenders.
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  return userId;
}
