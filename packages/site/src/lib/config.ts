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

const releaseBase = `${SITE.githubUrl}/releases/download/v0.4.1-beta`;

export const RELEASE = {
  version: "0.4.1",
  channel: "Beta",
  date: "2026-09-28",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.4.1.apk",
    url: `${releaseBase}/Kant-0.4.1.apk`,
    size: "5.7 MB",
    sha256: "1ed9bf86a84bc9c52ac869558e80c66292092cb5f90cbc8c0026d8b60ae9cb68",
  },
  linux: {
    file: "Kant-0.4.1.AppImage",
    url: `${releaseBase}/Kant-0.4.1.AppImage`,
    size: "118 MB",
    sha256: "9c34d8c3bac6f5e32172898ca722129c0a4766c5dd23f491e7b5d1a31e3f5b9b",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
