import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { AUTH_COOKIE, signSession, verifyPasscode } from "@/lib/auth";
import { log, requestIdFrom } from "@/lib/log";

// Login throttle. After this many failed attempts within the window
// from a given IP, /api/login returns 429 instead of doing scrypt
// work. Tuned for casual-snooper: lenient enough for a human who
// fat-fingers the passcode 3-4 times in a row, strict enough that
// brute force is impractical even at 100ms per scrypt.
const MAX_FAILS_PER_WINDOW = 10;
const WINDOW_MINUTES = 10;
// 7 days. Was 30 — shorter session reduces the blast radius if a
// cookie ever leaks (lost device, shared computer, etc.). Casual
// re-login once a week is acceptable friction.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Passcodes are short and a household has a handful of users, so iterating
// the full users table per login is fine. Each iteration runs a scrypt
// verify (intentionally slow), which is the rate limit on brute force.
export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request.headers);
  const ip = clientIp(request);
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/") || "/";

  const db = getDb();

  // Throttle gate: count failures from this IP in the recent window.
  // Cheap indexed lookup. Reject before any scrypt work.
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const [{ n: recentFails }] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(schema.loginAttempts)
    .where(
      and(
        eq(schema.loginAttempts.ip, ip),
        gte(schema.loginAttempts.attemptedAt, windowStart),
      ),
    );
  if (recentFails >= MAX_FAILS_PER_WINDOW) {
    log("auth.login.throttled", {
      request_id: requestId,
      ip,
      recent_fails: recentFails,
    });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "throttled");
    return NextResponse.redirect(url, { status: 303 });
  }

  if (!passcode) {
    await recordFail(db, ip);
    log("auth.login.failure", { request_id: requestId, ip, reason: "empty_passcode" });
    return invalid(request, next);
  }

  const users = await db
    .select({ id: schema.users.id, passcodeHash: schema.users.passcodeHash })
    .from(schema.users);

  const match = users.find((u) => verifyPasscode(passcode, u.passcodeHash));
  if (!match) {
    await recordFail(db, ip);
    // Crucially: never log the supplied passcode itself, only the failure
    // event. The point is operator visibility, not credential exposure.
    log("auth.login.failure", {
      request_id: requestId,
      ip,
      reason: "no_match",
      candidates: users.length,
      recent_fails: recentFails + 1,
    });
    return invalid(request, next);
  }
  log("auth.login.success", {
    request_id: requestId,
    ip,
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
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

// Insert the failure row AND opportunistically prune older entries so
// the table stays bounded without a separate cron. One round-trip per
// failed attempt is the right trade — a failed login is rare.
async function recordFail(db: ReturnType<typeof getDb>, ip: string) {
  await db.insert(schema.loginAttempts).values({ ip });
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1h
  await db
    .delete(schema.loginAttempts)
    .where(sql`${schema.loginAttempts.attemptedAt} < ${cutoff.toISOString()}`);
}

// X-Forwarded-For is set by Vercel for inbound requests. First entry
// is the real client; anything after is intermediate proxies. Fall
// back to "unknown" so missing-header requests still get a stable
// throttle bucket (rather than null, which could bypass).
function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return "unknown";
}

function invalid(request: NextRequest, next: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("error", "invalid");
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}
