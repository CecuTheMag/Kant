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

const releaseBase = `${SITE.githubUrl}/releases/download/v0.4.2-beta`;

export const RELEASE = {
  version: "0.4.2",
  channel: "Beta",
  date: "2026-09-29",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.4.2.apk",
    url: `${releaseBase}/Kant-0.4.2.apk`,
    size: "5.7 MB",
    sha256: "236398bd47fe1779f59a702a4e16ce569ce480d5fe23050da4aa699b5a1d43b6",
  },
  linux: {
    file: "Kant-0.4.2.AppImage",
    url: `${releaseBase}/Kant-0.4.2.AppImage`,
    size: "118 MB",
    sha256: "8c4f18d40d2672bbe97e78ec6d37528f1e90ba607474242b4fa3ba4b584008d4",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
