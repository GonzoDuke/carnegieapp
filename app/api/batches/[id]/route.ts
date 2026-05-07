import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const db = getDb();
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, id))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const books = await db
    .select()
    .from(schema.books)
    .where(eq(schema.books.batchId, id));
  return NextResponse.json({ batch, books });
}

const UpdateBatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const db = getDb();
  const [row] = await db
    .update(schema.batches)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    })
    .where(eq(schema.batches.id, id))
    .returning();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ batch: row });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .delete(schema.batches)
    .where(eq(schema.batches.id, id))
    .returning();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
