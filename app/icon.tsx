import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

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
          background: "#0a0e1a",
          color: "#e2e8f0",
          fontSize: 220,
          fontWeight: 700,
          letterSpacing: "-0.05em",
          fontFamily: "monospace",
        }}
      >
        PP
      </div>
    ),
    size,
  );
}
