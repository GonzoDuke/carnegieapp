import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

// Account-scoped user preferences. Currently just the duplicate-warning
// mute; add more optional fields here as the settings surface grows.
const PayloadSchema = z
  .object({
    ignoreDuplicates: z.boolean(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  const body = await request.json().catch(() => null);
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.users)
    .set({ ignoreDuplicates: parsed.data.ignoreDuplicates })
    .where(eq(schema.users.id, userId))
    .returning({ ignoreDuplicates: schema.users.ignoreDuplicates });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ignoreDuplicates: updated.ignoreDuplicates });
}
