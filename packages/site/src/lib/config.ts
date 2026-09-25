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

const releaseBase = `${SITE.githubUrl}/releases/download/v0.3.0-beta`;

export const RELEASE = {
  version: "0.3.0",
  channel: "Beta",
  date: "2026-09-25",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.3.0.apk",
    url: `${releaseBase}/Kant-0.3.0.apk`,
    size: "5.4 MB",
    sha256: "8a20d1f2d455d2ec55cab4d625b9d4ec96f318c522e0c2cae965084a3e5ff847",
  },
  linux: {
    file: "Kant-0.3.0.AppImage",
    url: `${releaseBase}/Kant-0.3.0.AppImage`,
    size: "120 MB",
    sha256: "38353962c8c2a144de0006f560f4b8653b502c533e170302de164867a3551966",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
