import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";

type RouteContext = { params: Promise<{ id: string }> };

const PayloadSchema = z.object({
  // 0.85 is a reasonable default — vision extracts at this confidence rarely
  // misread the title. Tweak per-call if you want more/less aggressive.
  minConfidence: z.number().min(0).max(1).optional().default(0.85),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
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
  // gte excludes NULL confidence automatically — manual / barcode-only rows
  // (which have no confidence score) are left in pending_review.
  const updated = await db
    .update(schema.books)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.status, "pending_review"),
        gte(schema.books.confidence, parsed.data.minConfidence),
      ),
    )
    .returning({ id: schema.books.id });

  return NextResponse.json({
    confirmed: updated.length,
    minConfidence: parsed.data.minConfidence,
  });
}
