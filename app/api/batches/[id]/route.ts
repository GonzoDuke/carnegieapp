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
  location: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

async function applyUpdate(id: string, data: z.infer<typeof UpdateBatchSchema>) {
  const db = getDb();
  const [row] = await db
    .update(schema.batches)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.location !== undefined && { location: data.location || null }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
    })
    .where(eq(schema.batches.id, id))
    .returning();
  return row;
}

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
  const row = await applyUpdate(id, parsed.data);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ batch: row });
}

const FormUpdateSchema = UpdateBatchSchema.extend({
  _action: z.literal("update"),
});

// Form-friendly POST so the inline edit form on the batch page can submit
// without JavaScript. Mirrors the per-book edit pattern.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const form = await request.formData();
  const body = Object.fromEntries(form.entries());
  const parsed = FormUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const row = await applyUpdate(id, parsed.data);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
    status: 303,
  });
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
