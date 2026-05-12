// Diagnostic endpoint — tries a one-byte Blob upload and reports the
// raw outcome so we can see why the vision route's Blob calls are
// failing in production. Auth-gated to the current user; safe to
// leave deployed since it only writes a few bytes per hit.
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireUserId } from "@/lib/auth";

export async function GET() {
  await requireUserId();

  const env = {
    hasToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    tokenLen: process.env.BLOB_READ_WRITE_TOKEN?.length ?? 0,
    nodeEnv: process.env.NODE_ENV,
  };

  try {
    const result = await put(
      `debug/${Date.now()}.txt`,
      "carnegie blob probe",
      { access: "public", contentType: "text/plain" },
    );
    return NextResponse.json({
      ok: true,
      env,
      url: result.url,
      pathname: result.pathname,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      env,
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : null,
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n") : null,
    });
  }
}
