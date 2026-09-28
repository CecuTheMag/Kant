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

const releaseBase = `${SITE.githubUrl}/releases/download/v0.4.0-beta`;

export const RELEASE = {
  version: "0.4.0",
  channel: "Beta",
  date: "2026-09-28",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.4.0.apk",
    url: `${releaseBase}/Kant-0.4.0.apk`,
    size: "5.6 MB",
    sha256: "b29402446fa53bfd333cc95cb35eb63340a953efe60572789415ad3ed0b573e0",
  },
  linux: {
    file: "Kant-0.4.0.AppImage",
    url: `${releaseBase}/Kant-0.4.0.AppImage`,
    size: "118 MB",
    sha256: "c536a08fc2e745f7ef2869360ab6a15f2baba86fb527bb61d043bb347f8f07ce",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
