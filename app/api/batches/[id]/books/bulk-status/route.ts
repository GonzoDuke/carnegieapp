import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";

type RouteContext = { params: Promise<{ id: string }> };

const PayloadSchema = z.object({
  bookIds: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["pending_review", "confirmed", "rejected"]),
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
  const updated = await db
    .update(schema.books)
    .set({ status: parsed.data.status })
    .where(
      and(
        eq(schema.books.batchId, id),
        inArray(schema.books.id, parsed.data.bookIds),
      ),
    )
    .returning({ id: schema.books.id });

  return NextResponse.json({
    updated: updated.length,
    status: parsed.data.status,
  });
}
