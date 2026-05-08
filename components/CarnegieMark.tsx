// The Carnegie identity mark — a stylized library bookplate.
//
//   ┌─────────────────┐
//   │■■tartan headband■│  ← narrow tartan strip, like a book's headband
//   │ ┌─────────────┐ │     (the colored fabric on a hardcover spine)
//   │ │             │ │  ← thin gold inner border (bookplate brass)
//   │ │      C      │ │  ← serif C, centered, deep cream/gold
//   │ │             │ │
//   │ └─────────────┘ │
//   └─────────────────┘
//
// Sized via the `size` prop. Designed to scale from 20px to 96px.
// Uses fixed hex colors so the mark stays consistent regardless of theme.

type Props = {
  size?: number;
  className?: string;
};

const FOREST = "#1f3d2a";
const GOLD = "#d4a64b";
const CREAM = "#f3ecd6";
const NAVY = "#0f1c33";
const RED = "#9c2c2c";

export function CarnegieMark({ size = 32, className }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Carnegie"
    >
      {/* Outer plate */}
      <rect width="64" height="64" rx="9" fill={FOREST} />

      {/* Tartan headband across the top — interlocking stripes evoke
          the colored fabric headband of a bound book. */}
      <g>
        <rect x="0" y="0" width="64" height="9" fill={FOREST} />
        {/* Vertical accents */}
        <g fillOpacity="0.9">
          <rect x="9" y="0" width="3" height="9" fill={NAVY} />
          <rect x="22" y="0" width="2" height="9" fill={GOLD} />
          <rect x="32" y="0" width="2" height="9" fill={RED} />
          <rect x="44" y="0" width="3" height="9" fill={NAVY} />
        </g>
        {/* Horizontal pencil */}
        <rect x="0" y="3" width="64" height="0.5" fill={CREAM} fillOpacity="0.55" />
      </g>

      {/* Inner gold border — a beat away from the edge, like a library
          ex-libris frame */}
      <rect
        x="6"
        y="13"
        width="52"
        height="46"
        rx="5"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.2"
        strokeOpacity="0.9"
      />

      {/* Serif C centered. Using a system serif because we render this
          before the Cormorant Garamond font may have loaded — fallback
          stack favors well-cut serifs that already exist on most
          systems. */}
      <text
        x="32"
        y="48"
        textAnchor="middle"
        fontFamily='"Cormorant Garamond", "EB Garamond", Georgia, "Times New Roman", serif'
        fontSize="36"
        fontWeight="600"
        fill={CREAM}
        letterSpacing="-0.5"
      >
        C
      </text>
    </svg>
  );
}
