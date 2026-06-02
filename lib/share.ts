import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

// Public-share tokens are bearer capabilities: whoever holds the token can
// read the owner's carts. They must be unguessable, so we mint 24 random
// bytes (192 bits) as url-safe base64 — long enough that enumeration is
// hopeless, short enough to paste into a chat. Regenerating simply mints a
// fresh one, which orphans every previously-shared link (revocation).
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

// Token → ownerId, or null if the token doesn't match an enabled share.
// The share pages call this instead of requireUserId — it is the ONLY
// authorization for the public surface, so it must fail closed: empty or
// malformed input returns null rather than matching the first row.
export async function resolveShareToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const db = getDb();
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.shareToken, token))
    .limit(1);
  return row?.id ?? null;
}
