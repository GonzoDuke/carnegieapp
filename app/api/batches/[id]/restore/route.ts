import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

// Undo for batch delete. Flips deleted_at back to null on a
// soft-deleted batch owned by the current user. Only matches when
// the batch IS currently soft-deleted — re-restoring an already-
// active batch is a no-op (and returns 404 to keep the surface
// honest). Owner-scoped, so foreign IDs cannot be restored.
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .update(schema.batches)
    .set({ deletedAt: null })
    .where(
      and(
        eq(schema.batches.id, id),
        eq(schema.batches.ownerId, userId),
        isNotNull(schema.batches.deletedAt),
      ),
    )
    .returning({ id: schema.batches.id });

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: row.id });
}
