import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";

export const REQUEST_ID_HEADER = "x-request-id";

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

  // Request-id stitches a single user action across proxy, page render,
  // and downstream API calls. Reuse an upstream-supplied id (so cURL or
  // a client can correlate) or mint one. Echoed back on the response so
  // the browser network tab can copy it.
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.length <= 80 ? incoming : randomUUID();

  if (isPublicPath(pathname)) {
    const res = NextResponse.next();
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  // No DB lookup — verifySession HMAC-checks the cookie against
  // APP_AUTH_SECRET, returning the userId iff the signature is valid.
  // Per-user data filtering happens downstream in pages and routes.
  const provided = request.cookies.get(AUTH_COOKIE)?.value;
  if (provided && verifySession(provided)) {
    const res = NextResponse.next({
      request: {
        // Inject the request-id into the inbound request headers so
        // route handlers can read it via request.headers.get(...).
        headers: new Headers({
          ...Object.fromEntries(request.headers),
          [REQUEST_ID_HEADER]: requestId,
        }),
      },
    });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  if (pathname.startsWith("/api/")) {
    const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  const res = NextResponse.redirect(url);
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
};
