// Single source of truth for links that don't exist yet. Update these two
// before going live — everything else on the site reads from here.
export const SITE = {
  name: "Kant",
  domain: "kant.network",
  url: "https://kant.network",
  tagline: "Serverless, end-to-end encrypted, peer-to-peer.",
  description:
    "Kant is a serverless, end-to-end encrypted peer-to-peer messenger built on libp2p and libsodium. No central server ever holds a message — not even the relay that connects you.",
  discordUrl: "https://discord.gg/kant", // TODO: replace with the real invite
  githubUrl: "https://github.com/kant-project/kant", // TODO: replace with the real repo
};

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/security", label: "Security" },
  { href: "/community", label: "Community" },
];
