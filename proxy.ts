import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

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

  const expected = process.env.APP_PASSCODE;
  if (!expected) {
    // No passcode configured — fail closed.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "APP_PASSCODE is not configured on the server." },
        { status: 503 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("setup", "1");
    return NextResponse.redirect(url);
  }

  const provided = request.cookies.get(AUTH_COOKIE)?.value;
  if (provided === expected) return NextResponse.next();

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
