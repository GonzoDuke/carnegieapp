// Re-generates public/icon.svg and public/icon-maskable.svg by embedding the
// Modern Carnegie tartan (public/tartanImagePrototype.jpg) as a base64 image
// behind the white book-stack mark.
//
// Run once after swapping the tartan asset: `node scripts/build-icons.mjs`.
// The output SVGs are self-contained (no relative resource fetches), so
// they work as PWA / favicon assets across browsers without needing the
// proxy to whitelist nested file references.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const tartanPath = join(root, "public", "tartanImagePrototype.jpg");
const tartanBase64 = readFileSync(tartanPath).toString("base64");
const tartanHref = `data:image/jpeg;base64,${tartanBase64}`;

// Book-stack rectangles — same geometry as components/BrandMark.tsx, in the
// 0 0 512 512 viewBox. Stroke gives definition against light tartan stripes;
// the white fill carries against dark stripes.
const bookStack = `
  <g fill="#ffffff" stroke="rgba(0,0,0,0.45)" stroke-width="6" stroke-linejoin="round">
    <rect x="120" y="120" width="60" height="272" rx="6"/>
    <rect x="200" y="160" width="56" height="232" rx="6"/>
    <rect x="276" y="100" width="52" height="292" rx="6" transform="rotate(6 302 246)"/>
    <rect x="350" y="140" width="48" height="252" rx="6" transform="rotate(-4 374 266)"/>
    <rect x="96" y="396" width="320" height="20" rx="4"/>
  </g>
`;

// Standard PWA icon: rounded square, full bleed tartan, full-size mark.
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="rounded"><rect width="512" height="512" rx="96"/></clipPath>
  </defs>
  <g clip-path="url(#rounded)">
    <image href="${tartanHref}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid slice"/>
    ${bookStack.trim()}
  </g>
</svg>
`;

// Maskable icon: per W3C spec, only the central 80% of the canvas is
// guaranteed to survive the mask. We keep the tartan full-bleed so the
// fabric reads on the visible portion, and shrink the mark into the safe
// zone (roughly 60% of the canvas, centered) so it doesn't get clipped.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <image href="${tartanHref}" x="0" y="0" width="512" height="512" preserveAspectRatio="xMidYMid slice"/>
  <g transform="translate(102 102) scale(0.6)">
    ${bookStack.trim()}
  </g>
</svg>
`;

writeFileSync(join(root, "public", "icon.svg"), iconSvg, "utf8");
writeFileSync(join(root, "public", "icon-maskable.svg"), maskableSvg, "utf8");

const iconKb = (iconSvg.length / 1024).toFixed(1);
const maskKb = (maskableSvg.length / 1024).toFixed(1);
console.log(`Wrote public/icon.svg (${iconKb} KB)`);
console.log(`Wrote public/icon-maskable.svg (${maskKb} KB)`);
