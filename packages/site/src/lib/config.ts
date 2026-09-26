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

const releaseBase = `${SITE.githubUrl}/releases/download/v0.3.1-beta`;

export const RELEASE = {
  version: "0.3.1",
  channel: "Beta",
  date: "2026-09-26",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.3.1.apk",
    url: `${releaseBase}/Kant-0.3.1.apk`,
    size: "5.5 MB",
    sha256: "a51640781827fa83ba12da9630ac45e360cccaf3eb129824fd7b1c393a8127be",
  },
  linux: {
    file: "Kant-0.3.1.AppImage",
    url: `${releaseBase}/Kant-0.3.1.AppImage`,
    size: "120 MB",
    sha256: "0637e377c4583e6f5104d0fc606912bf5a0b241a8bd4e202acd048b74ec24e89",
  },
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
