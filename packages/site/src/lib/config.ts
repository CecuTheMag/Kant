// Single source of truth for names, links and release info. Everything on the
// site reads from here — bump RELEASE when a new build ships.
export const SITE = {
  name: "Kant",
  domain: "kant.network",
  url: "https://kant.network",
  tagline: "Private messaging, with no one in the middle.",
  description:
    "Kant is a free, end-to-end encrypted messenger that sends your messages straight to the people you talk to. No phone number, no email, and no company server keeping a copy.",
  discordUrl: "https://discord.gg/kdn2tAPtRX",
  githubUrl: "https://github.com/CecuTheMag/Kant",
};

const releaseBase = `${SITE.githubUrl}/releases/download/0.5.0-beta`;

export const RELEASE = {
  version: "0.5.0",
  channel: "Beta",
  date: "2026-10-03",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.5.0.apk",
    url: `${releaseBase}/Kant-0.5.0.apk`,
    size: "5.8 MB",
    sha256: "1dcbbfbd5dd87a7313ae24f4013dc7a3831c6675236565d3fc399433e0ffb228",
  },
  linux: {
    file: "Kant-0.5.0.AppImage",
    url: `${releaseBase}/Kant-0.5.0.AppImage`,
    size: "120 MB",
    sha256: "0cf93495096effbddc8e87f536da2f835ae56d1100beb824b74cf4f86bc009ef",
  },
  // Windows builds come from the release workflow (0.5.0 on). Leave null for a
  // release without one and the download page shows Windows as "not yet".
  windows: null as null | { file: string; url: string; size: string; sha256: string },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
