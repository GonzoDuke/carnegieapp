import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

const PayloadSchema = z.object({
  // 0.85 is a reasonable default — vision extracts at this confidence rarely
  // misread the title. Tweak per-call if you want more/less aggressive.
  minConfidence: z.number().min(0).max(1).optional().default(0.85),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  // The owner_id filter on books makes the operation safe even if a foreign
  // batch id is supplied — the WHERE will return zero matches and the
  // update is a no-op rather than a leak. gte excludes NULL confidence.
  const updated = await db
    .update(schema.books)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.ownerId, userId),
        eq(schema.books.status, "pending_review"),
        gte(schema.books.confidence, parsed.data.minConfidence),
      ),
    )
    .returning({ id: schema.books.id });

  // Return the affected IDs so the client can show an Undo toast
  // that pipes them back through bulk-status with action=to-pending.
  // Cheap (these are uuids, list bounded by batch size).
  return NextResponse.json({
    confirmed: updated.length,
    confirmedIds: updated.map((u) => u.id),
    minConfidence: parsed.data.minConfidence,
  });
}
