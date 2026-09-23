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

const releaseBase = `${SITE.githubUrl}/releases/download/v0.2.0-beta`;

export const RELEASE = {
  version: "0.2.0",
  channel: "Beta",
  date: "2026-09-21",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.2.0.apk",
    url: `${releaseBase}/Kant-0.2.0.apk`,
    size: "5.3 MB",
    sha256: "4f0767bc16b44e6d791f23007bbc7c8389bf7ea704dc651136b4e0fb8d3c7cd9",
  },
  linux: {
    file: "Kant-0.2.0.AppImage",
    url: `${releaseBase}/Kant-0.2.0.AppImage`,
    size: "120 MB",
    sha256: "abb657e7fe1786fa46adbaf07f24ecc824f19678254accae48b468ed56bcb863",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
