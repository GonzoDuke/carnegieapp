import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

// Actions on a list of books in a batch. `delete` is now SOFT —
// flips status to `rejected` so the user can recover from the Trash
// view. `permanent-delete` is the real hard delete, only used by the
// Trash UI's "Delete forever" button. `confirm` flips status to
// confirmed. `to-pending` flips status back to pending_review (used
// by Bulk-confirm's Undo and by Restore-from-trash).
const PayloadSchema = z.object({
  bookIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["confirm", "delete", "permanent-delete", "to-pending"]),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();

  // Constrain to bookIds that belong to this batch AND this user.
  // Foreign batch IDs or foreign user attempts produce zero-match no-ops.
  const scope = and(
    eq(schema.books.batchId, id),
    eq(schema.books.ownerId, userId),
    inArray(schema.books.id, parsed.data.bookIds),
  );

  if (parsed.data.action === "permanent-delete") {
    const removed = await db
      .delete(schema.books)
      .where(scope)
      .returning({ id: schema.books.id });
    return NextResponse.json({
      updated: removed.length,
      action: "permanent-delete",
    });
  }

  const nextStatus =
    parsed.data.action === "confirm"
      ? ("confirmed" as const)
      : parsed.data.action === "delete"
        ? ("rejected" as const)
        : ("pending_review" as const);

  const updated = await db
    .update(schema.books)
    .set({ status: nextStatus })
    .where(scope)
    .returning({ id: schema.books.id });

  return NextResponse.json({
    updated: updated.length,
    action: parsed.data.action,
  });
}
