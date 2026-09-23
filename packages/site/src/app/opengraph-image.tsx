import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE } from "@/lib/config";

export const runtime = "nodejs";
export const alt = `${SITE.name} — private, encrypted messaging with no one in the middle`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bubble = (text: string, out: boolean) => (
  <div
    style={{
      display: "flex",
      alignSelf: out ? "flex-end" : "flex-start",
      maxWidth: 230,
      padding: "12px 16px",
      borderRadius: 22,
      fontSize: 19,
      lineHeight: 1.3,
      color: out ? "#fff" : "#eef2f7",
      background: out ? "#4f8ef7" : "#1f2937",
    }}
  >
    {text}
  </div>
);

// Satori needs TTF/OTF, so pull static Inter weights at build time (same
// source next/font uses). Falls back to the default face if offline.
async function loadInter(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OG)" },
      })
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OGImage() {
  const [regular, bold] = await Promise.all([loadInter(400), loadInter(700)]);
  const fonts = [
    ...(regular ? [{ name: "Inter", data: regular, weight: 400 as const, style: "normal" as const }] : []),
    ...(bold ? [{ name: "Inter", data: bold, weight: 700 as const, style: "normal" as const }] : []),
  ];
  const logo = await readFile(path.join(process.cwd(), "public/logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 90px",
          background: "#ffffff",
          backgroundImage:
            "radial-gradient(55% 80% at 78% 55%, rgba(34,169,201,0.20), rgba(10,103,216,0.06) 60%, transparent)",
          fontFamily: fonts.length ? "Inter" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} width={52} height={52} alt="" />
            <div style={{ fontSize: 38, fontWeight: 700, color: "#1d1d1f", letterSpacing: -1.2 }}>{SITE.name}</div>
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#1d1d1f", letterSpacing: -3, lineHeight: 1.02 }}>
            Your messages.
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, color: "#1d1d1f", letterSpacing: -3, lineHeight: 1.02, marginBottom: 30 }}>
            Nobody else’s.
          </div>
          <div style={{ fontSize: 28, color: "#6e6e73", lineHeight: 1.35 }}>
            Free, end-to-end encrypted messaging. No phone number. No company in the middle.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: 300,
            height: 540,
            marginTop: 150,
            padding: 12,
            borderRadius: 56,
            background: "#111113",
            boxShadow: "0 40px 80px -20px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: 12,
              width: "100%",
              height: "100%",
              borderRadius: 46,
              background: "#0d1117",
              padding: "70px 16px 16px",
            }}
          >
            {bubble("Landed! Sending the photos now.", false)}
            {bubble("Wow. That view!", true)}
            {bubble("Dinner Friday? My treat.", false)}
            {bubble("Deal.", true)}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
