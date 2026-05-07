import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/") || "/";
  const expected = process.env.APP_PASSCODE;

  if (!expected || passcode !== expected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "invalid");
    if (next && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const response = NextResponse.redirect(new URL(safeNext, request.url), {
    status: 303,
  });
  response.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
