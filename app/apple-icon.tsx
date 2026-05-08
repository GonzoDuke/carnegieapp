import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

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
          background: "#0a0a0a",
          color: "#fafafa",
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        zp
        <div
          style={{
            marginTop: 8,
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: 2,
            opacity: 0.6,
            textTransform: "uppercase",
          }}
        >
          Zippy Planet
        </div>
      </div>
    ),
    { ...size },
  );
}
