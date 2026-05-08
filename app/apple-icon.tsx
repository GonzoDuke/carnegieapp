import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Full-bleed bookplate icon for iOS home screen. Forest plate, tartan
// headband across the top, gold inner border, large serif "C", and the
// "Carnegie" wordmark below.
export default function AppleIcon() {
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
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Tartan headband across the top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 22,
            display: "flex",
          }}
        >
          <div style={{ flex: 5, background: "#0f1c33" }} />
          <div style={{ flex: 1, background: "#d4a64b" }} />
          <div style={{ flex: 4, background: "#0f1c33" }} />
          <div style={{ flex: 1, background: "#9c2c2c" }} />
          <div style={{ flex: 5, background: "#0f1c33" }} />
        </div>

        {/* Cream pencil line under the tartan */}
        <div
          style={{
            position: "absolute",
            top: 22,
            left: 0,
            right: 0,
            height: 1,
            background: "#f3ecd6",
            opacity: 0.5,
          }}
        />

        {/* Inner gold border — bookplate frame */}
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 14,
            right: 14,
            bottom: 14,
            border: "2px solid #d4a64b",
            borderRadius: 12,
            opacity: 0.85,
          }}
        />

        <span
          style={{
            fontFamily:
              '"Cormorant Garamond", "EB Garamond", Georgia, "Times New Roman", serif',
            fontWeight: 600,
            fontSize: 110,
            letterSpacing: -3,
            lineHeight: 1,
            marginTop: 18,
          }}
        >
          C
        </span>
        <span
          style={{
            marginTop: 6,
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: 3,
            color: "#d4a64b",
            opacity: 0.95,
            textTransform: "uppercase",
          }}
        >
          Carnegie
        </span>
      </div>
    ),
    { ...size },
  );
}
