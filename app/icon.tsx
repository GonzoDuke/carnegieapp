/* eslint-disable @next/next/no-img-element -- Satori/ImageResponse renders
   raw <img>; next/image is not supported inside it. */
import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// 32px favicon — tartan won't read at this size (it'd just be color noise),
// so we use a single deep navy sampled from the dark stripe of the Modern
// Carnegie sett, with a small white book-stack on top. The full tartan
// version lives on the 180px apple-icon and the 512px PWA icon.
const NAVY = "#1a2030";

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

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: NAVY,
          borderRadius: 6,
        }}
      >
        <img src={brandMarkSrc} alt="" width={22} height={22} />
      </div>
    ),
    { ...size },
  );
}
