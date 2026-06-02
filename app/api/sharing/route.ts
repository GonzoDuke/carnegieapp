import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { requireUserId } from "@/lib/auth";
import { generateShareToken } from "@/lib/share";

// Toggle / rotate the current user's public share token. Form-POST (no JS
// needed) from the /sharing page; redirects back there so the page re-renders
// with the new state.
export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  const form = await request.formData();
  const action = String(form.get("_action") ?? "");
  const db = getDb();

  if (action === "enable" || action === "regenerate") {
    // Minting a fresh token on regenerate orphans every link shared so far.
    await db
      .update(schema.users)
      .set({ shareToken: generateShareToken(), sharedAt: new Date() })
      .where(eq(schema.users.id, userId));
  } else if (action === "disable") {
    await db
      .update(schema.users)
      .set({ shareToken: null, sharedAt: null })
      .where(eq(schema.users.id, userId));
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.redirect(new URL("/sharing", request.url), {
    status: 303,
  });
}
