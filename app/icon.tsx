import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Compact favicon: forest-green plate, narrow tartan strip across the top
// (echoing a book's headband), serif "C" in cream/gold. At 32×32 the full
// bookplate frame doesn't survive — this is the boiled-down version.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f3d2a",
          color: "#f3ecd6",
          borderRadius: 5,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Tartan strip — three thin colored bars across the top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            display: "flex",
          }}
        >
          <div style={{ flex: 4, background: "#0f1c33" }} />
          <div style={{ flex: 1, background: "#d4a64b" }} />
          <div style={{ flex: 1, background: "#9c2c2c" }} />
          <div style={{ flex: 4, background: "#0f1c33" }} />
        </div>
        <span
          style={{
            fontFamily:
              '"Cormorant Garamond", "EB Garamond", Georgia, "Times New Roman", serif',
            fontWeight: 600,
            fontSize: 24,
            lineHeight: 1,
            marginTop: 4,
          }}
        >
          C
        </span>
      </div>
    ),
    { ...size },
  );
}
