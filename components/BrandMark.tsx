// Inlined book-stack mark from public/icon.svg. Inlined (rather than <img>)
// so it inherits currentColor and can be re-coloured per-context (amber on
// the parchment chip, white on the tartan chip, etc.).
export default function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="120" y="120" width="60" height="272" rx="6" />
      <rect x="200" y="160" width="56" height="232" rx="6" />
      <rect
        x="276"
        y="100"
        width="52"
        height="292"
        rx="6"
        transform="rotate(6 302 246)"
      />
      <rect
        x="350"
        y="140"
        width="48"
        height="252"
        rx="6"
        transform="rotate(-4 374 266)"
      />
      <rect x="96" y="396" width="320" height="20" rx="4" />
    </svg>
  );
}
