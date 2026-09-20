import { ImageResponse } from "next/og";
import { SITE } from "@/lib/config";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          background: "#08090b",
          backgroundImage:
            "radial-gradient(60% 90% at 15% 0%, rgba(34,211,238,0.14), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 44 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              border: "2px solid #2c3340",
              background: "#151920",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#22d3ee",
              fontSize: 26,
              fontWeight: 650,
            }}
          >
            K
          </div>
          <div style={{ fontSize: 34, fontWeight: 650, color: "#eef1f5", letterSpacing: -1 }}>
            {SITE.name}
          </div>
        </div>
        <div
          style={{
            fontSize: 62,
            fontWeight: 650,
            color: "#eef1f5",
            letterSpacing: -2,
            lineHeight: 1.08,
            maxWidth: 920,
            marginBottom: 28,
          }}
        >
          Messaging infrastructure you own outright.
        </div>
        <div style={{ fontSize: 26, color: "#98a1ad", maxWidth: 780 }}>
          {SITE.description}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 48 }}>
          {["libp2p", "libsodium", "X3DH", "Double Ratchet"].map((tag) => (
            <div
              key={tag}
              style={{
                fontSize: 18,
                color: "#7d8695",
                border: "1px solid #2c3340",
                borderRadius: 8,
                padding: "8px 16px",
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
