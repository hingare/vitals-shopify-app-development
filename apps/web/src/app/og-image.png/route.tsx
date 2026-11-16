import { brand } from "@app/brand";
import { ImageResponse } from "next/og";
import { toolIds } from "@/lib/catalog";

/** The picture shown when a page of the site is shared on social media or in chat apps. */
export const dynamic = "force-static";

export function GET() {
  const count = toolIds().length;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: "linear-gradient(135deg, #1e1b4b 0%, #4f46e5 70%, #6366f1 100%)",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "20px", fontSize: 40 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: "#ffffff",
            display: "flex",
            flexWrap: "wrap",
            padding: 12,
            gap: 6,
          }}
        >
          {["#4F46E5", "#A5B4FC", "#A5B4FC", "#4F46E5"].map((color, i) => (
            <div key={i} style={{ width: 21, height: 21, borderRadius: 6, background: color }} />
          ))}
        </div>
        <span style={{ fontWeight: 700 }}>{brand.name}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>
          {brand.tagline}
        </div>
        <div style={{ fontSize: 32, color: "#c7d2fe" }}>
          {`${count} tools for Shopify. One flat price, no usage fees.`}
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
