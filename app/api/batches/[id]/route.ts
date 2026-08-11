import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

// All operations are scoped by both id and ownerId — a foreign batch
// returns 404 (not 403) so we don't leak existence. Soft-deleted
// batches (deleted_at != null) also 404 from the read/edit surface;
// they're only accessible via the explicit /restore endpoint until
// either restored or hard-purged.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const db = getDb();
  const [batch] = await db
    .select()
    .from(schema.batches)
    .where(
      and(
        eq(schema.batches.id, id),
        eq(schema.batches.ownerId, userId),
        isNull(schema.batches.deletedAt),
      ),
    )
    .limit(1);
  if (!batch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const books = await db
    .select()
    .from(schema.books)
    .where(
      and(
        eq(schema.books.batchId, id),
        eq(schema.books.ownerId, userId),
      ),
    );
  return NextResponse.json({ batch, books });
}

const UpdateBatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  location: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

async function applyUpdate(
  id: string,
  userId: string,
  data: z.infer<typeof UpdateBatchSchema>,
) {
  const db = getDb();
  const [row] = await db
    .update(schema.batches)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.location !== undefined && { location: data.location || null }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
    })
    .where(
      and(
        eq(schema.batches.id, id),
        eq(schema.batches.ownerId, userId),
        isNull(schema.batches.deletedAt),
      ),
    )
    .returning();
  return row;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const row = await applyUpdate(id, userId, parsed.data);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ batch: row });
}

const FormUpdateSchema = UpdateBatchSchema.extend({
  _action: z.literal("update"),
});

// `complete` / `reopen` toggle batches.exported_at, which is the only
// thing separating a batch on the workbench from one in the Archive.
// This used to be a side effect of downloading the CSV; making it
// explicit means exporting is repeatable and filing is reversible.
const FormLifecycleSchema = z.object({
  _action: z.enum(["complete", "reopen"]),
});

async function applyLifecycle(
  id: string,
  userId: string,
  action: "complete" | "reopen",
) {
  const db = getDb();
  const [row] = await db
    .update(schema.batches)
    .set({ exportedAt: action === "complete" ? new Date() : null })
    .where(
      and(
        eq(schema.batches.id, id),
        eq(schema.batches.ownerId, userId),
        isNull(schema.batches.deletedAt),
      ),
    )
    .returning({ id: schema.batches.id });
  return row;
}

// Form-friendly POST so the inline edit form on the batch page can submit
// without JavaScript. Mirrors the per-book edit pattern.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const form = await request.formData();
  const body = Object.fromEntries(form.entries());

  const lifecycle = FormLifecycleSchema.safeParse(body);
  if (lifecycle.success) {
    const row = await applyLifecycle(id, userId, lifecycle.data._action);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
      status: 303,
    });
  }

  const parsed = FormUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const row = await applyUpdate(id, userId, parsed.data);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(new URL(`/batches/${id}`, request.url), {
    status: 303,
  });
}

// SOFT delete. Sets batches.deleted_at = now() so an Undo toast on
// the client can flip it back via /restore. The batch and all its
// books / photos stay in the DB; listing surfaces filter on
// deleted_at IS NULL. No auto-purge cron yet — operator can run a
// manual cleanup SQL if storage matters.
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .update(schema.batches)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.batches.id, id),
        eq(schema.batches.ownerId, userId),
        isNull(schema.batches.deletedAt),
      ),
    )
    .returning({ id: schema.batches.id });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
