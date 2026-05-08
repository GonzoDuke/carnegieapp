import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

export async function GET() {
  const userId = await requireUserId();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.ownerId, userId))
    .orderBy(desc(schema.batches.createdAt));
  return NextResponse.json({ batches: rows });
}

const CreateBatchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  const body = await readJsonOrForm(request);
  const parsed = CreateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const db = getDb();
  const [row] = await db
    .insert(schema.batches)
    .values({
      ownerId: userId,
      name: parsed.data.name,
      location: parsed.data.location || null,
      notes: parsed.data.notes || null,
    })
    .returning();

  if (request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.json({ batch: row }, { status: 201 });
  }
  return NextResponse.redirect(new URL(`/batches/${row.id}`, request.url), {
    status: 303,
  });
}

async function readJsonOrForm(request: NextRequest): Promise<unknown> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
