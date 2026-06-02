import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string; uploadId: string }> };

const PatchSchema = z.object({
  // Which physical box this photo shows. Empty string clears the label
  // (back to "Unlabeled" on the share view).
  boxLabel: z.string().trim().max(100).nullable().optional(),
});

// Update a single batch upload's metadata. Today that's just the box label,
// set from the batch page's photo panel and surfaced (grouped) on the public
// share view. Owner-scoped: a foreign upload id 404s.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const userId = await requireUserId();
  const { id, uploadId } = await params;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const boxLabel = parsed.data.boxLabel?.trim() || null;

  const [updated] = await db
    .update(schema.batchUploads)
    .set({ boxLabel })
    .where(
      and(
        eq(schema.batchUploads.id, uploadId),
        eq(schema.batchUploads.batchId, id),
        eq(schema.batchUploads.ownerId, userId),
      ),
    )
    .returning({ id: schema.batchUploads.id, boxLabel: schema.batchUploads.boxLabel });

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ upload: updated });
}
