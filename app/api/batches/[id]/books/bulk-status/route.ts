import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";

type RouteContext = { params: Promise<{ id: string }> };

// "delete" hard-removes rows. "confirm" flips status to confirmed.
// "Reject" no longer exists as a distinct state — rejected = deleted.
const PayloadSchema = z.object({
  bookIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["confirm", "delete"]),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
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

  // Constrain to bookIds that actually belong to this batch — protects
  // against arbitrary cross-batch updates if a stale ID slipped through.
  const scope = and(
    eq(schema.books.batchId, id),
    inArray(schema.books.id, parsed.data.bookIds),
  );

  if (parsed.data.action === "delete") {
    const removed = await db
      .delete(schema.books)
      .where(scope)
      .returning({ id: schema.books.id });
    return NextResponse.json({ updated: removed.length, action: "delete" });
  }

  const updated = await db
    .update(schema.books)
    .set({ status: "confirmed" })
    .where(scope)
    .returning({ id: schema.books.id });

  return NextResponse.json({ updated: updated.length, action: "confirm" });
}
