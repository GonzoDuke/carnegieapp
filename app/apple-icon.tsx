/* eslint-disable @next/next/no-img-element -- Satori/ImageResponse renders
   raw <img>; next/image is not supported inside it. */
import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Read the tartan once at module load and inline it as a data URL — Satori's
// <img> tag supports that without needing a fetch at request time.
const tartanBuf = readFileSync(
  join(process.cwd(), "public", "tartanImagePrototype.jpg"),
);
const tartanSrc = `data:image/jpeg;base64,${tartanBuf.toString("base64")}`;

// White book-stack mark, inlined as an SVG data URL so Satori can render it
// over the tartan backdrop. Drop-shadow is applied via CSS filter so the
// mark stays legible against any stripe of the sett.
const brandMarkSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g fill="#ffffff">
    <rect x="120" y="120" width="60" height="272" rx="6"/>
    <rect x="200" y="160" width="56" height="232" rx="6"/>
    <rect x="276" y="100" width="52" height="292" rx="6" transform="rotate(6 302 246)"/>
    <rect x="350" y="140" width="48" height="252" rx="6" transform="rotate(-4 374 266)"/>
    <rect x="96" y="396" width="320" height="20" rx="4"/>
  </g>
</svg>
`.trim();
const brandMarkSrc = `data:image/svg+xml;utf8,${encodeURIComponent(brandMarkSvg)}`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <img
          src={tartanSrc}
          alt=""
          width={180}
          height={180}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <img
          src={brandMarkSrc}
          alt=""
          width={108}
          height={108}
          style={{
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.55))",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
