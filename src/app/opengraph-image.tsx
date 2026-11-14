import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Panelista: find IT professionals to evaluate your capstone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Link preview for Facebook/Messenger shares (that is how students find this).
// Everything sits in the centre 600 px: Facebook's small card crops the image to a square.
export default async function OgImage() {
  const svg = await readFile(join(process.cwd(), "public/brand/logo-mark.svg"));
  const mark = `data:image/svg+xml;base64,${svg.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#176B55", color: "#F5F8F3", textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} width={176} height={176} alt="" style={{ borderRadius: 40, border: "5px solid #F5F8F3" }} />
        <div style={{ marginTop: 28, fontSize: 76, fontWeight: 700, letterSpacing: -1 }}>Panelista</div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", alignItems: "center", fontSize: 40, lineHeight: 1.25, color: "#D9EBE3" }}>
          <span>Find IT professionals</span>
          <span>to evaluate your capstone</span>
        </div>
      </div>
    ),
    size,
  );
}
