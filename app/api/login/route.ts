import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb, schema } from "@/lib/db/client";
import { AUTH_COOKIE, signSession, verifyPasscode } from "@/lib/auth";
import { log, requestIdFrom } from "@/lib/log";

// Passcodes are short and a household has a handful of users, so iterating
// the full users table per login is fine. Each iteration runs a scrypt
// verify (intentionally slow), which is the rate limit on brute force.
export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request.headers);
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/") || "/";

  if (!passcode) {
    log("auth.login.failure", { request_id: requestId, reason: "empty_passcode" });
    return invalid(request, next);
  }

  const db = getDb();
  const users = await db
    .select({ id: schema.users.id, passcodeHash: schema.users.passcodeHash })
    .from(schema.users);

  const match = users.find((u) => verifyPasscode(passcode, u.passcodeHash));
  if (!match) {
    // Crucially: never log the supplied passcode itself, only the failure
    // event. The point is operator visibility, not credential exposure.
    log("auth.login.failure", {
      request_id: requestId,
      reason: "no_match",
      candidates: users.length,
    });
    return invalid(request, next);
  }
  log("auth.login.success", {
    request_id: requestId,
    user_id: match.id,
  });

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const response = NextResponse.redirect(new URL(safeNext, request.url), {
    status: 303,
  });
  response.cookies.set(AUTH_COOKIE, signSession(match.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

function invalid(request: NextRequest, next: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("error", "invalid");
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}
