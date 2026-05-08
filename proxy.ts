import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";

// Anything PWA / icon / login-related must load without a session, otherwise
// browsers can't fetch icons from the manifest before the user signs in,
// and "Add to Home Screen" silently fails.
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/api/login") return true;
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/apple-icon") return true;
  if (pathname.startsWith("/icon")) return true;
  // Brand asset shown on the login page; must load before auth.
  if (pathname === "/tartanImagePrototype.jpg") return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // No DB lookup — verifySession HMAC-checks the cookie against
  // APP_AUTH_SECRET, returning the userId iff the signature is valid.
  // Per-user data filtering happens downstream in pages and routes.
  const provided = request.cookies.get(AUTH_COOKIE)?.value;
  if (provided && verifySession(provided)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
};
