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

const releaseBase = `${SITE.githubUrl}/releases/download/0.4.3-beta`;

export const RELEASE = {
  version: "0.4.3",
  channel: "Beta",
  date: "2026-10-01",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.4.3.apk",
    url: `${releaseBase}/Kant-0.4.3.apk`,
    size: "5.7 MB",
    sha256: "56df3dc9188eb87b0a489c2cd83fc5ed7f65d0425e08274b8b8779df3a5e5963",
  },
  linux: {
    file: "Kant-0.4.3.AppImage",
    url: `${releaseBase}/Kant-0.4.3.AppImage`,
    size: "118 MB",
    sha256: "7f633fd2d4cfad5f32cf87ffea4c0333b067c475ad61c69b544fd2f508106ce7",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
