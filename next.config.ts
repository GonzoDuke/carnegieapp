import type { NextConfig } from "next";

// Pragmatic security headers. Defense-in-depth on top of Vercel's
// defaults — explicit is better than relying on platform behavior.
//
// CSP is moderately strict: scripts/styles allow 'unsafe-inline'
// because Next.js's hydration boot uses inline <script> blocks and
// Tailwind ships utility classes via inline style attributes. Moving
// to nonce-based CSP would close that gap but requires per-request
// nonce plumbing — overkill for a two-user app. The image / connect
// allowlist is the part that actually defends against XSS-by-pixel
// and exfiltration: only providers Carnegie genuinely calls.
const securityHeaders = [
  // Disallow being framed by any origin. Defends against clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-type sniffing. Vercel sets this by default — explicit
  // override means a future config change can't silently strip it.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the origin only on cross-origin navigations; full URL within
  // same-origin. Avoids leaking batch URLs in Referer headers to
  // third-party lookup providers.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features we don't use; explicitly allow camera
  // for the in-app barcode scanner and photo capture.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  // CSP — block anything not on the allowlist.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Vercel Blob URLs, the three cover-image providers, and inline
      // data URIs (for embedded SVG / placeholder pixels).
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://covers.openlibrary.org https://images.isbndb.com https://books.google.com https://*.googleusercontent.com",
      // Next.js needs inline scripts for hydration; without nonce
      // infrastructure 'unsafe-inline' is the practical option.
      "script-src 'self' 'unsafe-inline'",
      // Tailwind ships inline style attributes via utility classes.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      // Camera stream for ZXing barcode scanner is a `mediaDevices` API,
      // not a connect-src concern. Outbound HTTP fetches happen from
      // server functions, not the browser, so connect-src is self only.
      "connect-src 'self' https://*.public.blob.vercel-storage.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://www.librarything.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
