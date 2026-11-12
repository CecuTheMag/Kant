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

const releaseBase = `${SITE.githubUrl}/releases/download/0.7.0-beta`;

export type Download = { file: string; url: string; size: string; sha256: string };
type WindowsDownloads = Record<"x64" | "arm64", { installer: Download; portable: Download }>;
type MacDownloads = Record<"arm64" | "x64", Download>;

export const RELEASE = {
  version: "0.7.0",
  channel: "Beta",
  date: "2026-11-12",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.7.0.apk",
    url: `${releaseBase}/Kant-0.7.0.apk`,
    size: "5.8 MB",
    sha256: "f9f765845347130a0edbab1137dc22358da1e8fe2a979b531cced73c213d39cf",
  },
  linux: {
    file: "Kant-0.7.0.AppImage",
    url: `${releaseBase}/Kant-0.7.0.AppImage`,
    size: "137 MB",
    sha256: "fbab8808af519e1888ee36edca5529e5156283fd96d1cb56d3262e216d942705",
  },
  // Windows builds come from the release workflow (0.5.0 on): an installer and
  // a portable exe for each architecture. Leave null for a release without
  // them and the site shows Windows as "not yet".
  windows: {
    x64: {
      installer: {
        file: "Kant-Setup-0.7.0-x64.exe",
        url: `${releaseBase}/Kant-Setup-0.7.0-x64.exe`,
        size: "127 MB",
        sha256: "4ae3a7eb9b9aaeb0d3eab6e49dc0802fbe677a4e18c4d31db9c305b04db84654",
      },
      portable: {
        file: "Kant-0.7.0-x64-portable.exe",
        url: `${releaseBase}/Kant-0.7.0-x64-portable.exe`,
        size: "127 MB",
        sha256: "5bac0eee901c4835ae3b7594b9c78057d7087af2134b2d37ad6b639d13747e43",
      },
    },
    arm64: {
      installer: {
        file: "Kant-Setup-0.7.0-arm64.exe",
        url: `${releaseBase}/Kant-Setup-0.7.0-arm64.exe`,
        size: "128 MB",
        sha256: "b6280e6abc8098e4f2466b66f9004b58868048903155cd032c53cc6d7aa0787b",
      },
      portable: {
        file: "Kant-0.7.0-arm64-portable.exe",
        url: `${releaseBase}/Kant-0.7.0-arm64-portable.exe`,
        size: "127 MB",
        sha256: "12603e1813e7bdf990912a52dfecb17ffd6b09243e7846736e631a62a38535dc",
      },
    },
  } as WindowsDownloads | null,
  // macOS DMGs (Apple Silicon and Intel) and the iPhone .ipa, from the release
  // workflow (0.6.0 on). Leave null for a release without them and the site
  // shows them as "coming later".
  mac: {
    arm64: {
      file: "Kant-0.7.0-mac-arm64.dmg",
      url: `${releaseBase}/Kant-0.7.0-mac-arm64.dmg`,
      size: "135 MB",
      sha256: "b11c296775b09fa804e5af7f90bc155802824d0829f82f29ca3a7198e1dcc988",
    },
    x64: {
      file: "Kant-0.7.0-mac-x64.dmg",
      url: `${releaseBase}/Kant-0.7.0-mac-x64.dmg`,
      size: "141 MB",
      sha256: "c96f6a9445fdadb3f51f0cc5d4d1feea2cc6976e2e297fb25ed933cbd37da78d",
    },
  } as MacDownloads | null,
  ios: {
    file: "Kant-0.7.0.ipa",
    url: `${releaseBase}/Kant-0.7.0.ipa`,
    size: "2.3 MB",
    sha256: "65dcc31e1d2516d610587a851dc643f2e4d89b02980c672931703dac120dc5fb",
  } as Download | null,
};

/** Every Windows file in this release, for checksums and listings. */
export const WINDOWS_FILES: Download[] = RELEASE.windows
  ? [RELEASE.windows.x64.installer, RELEASE.windows.x64.portable, RELEASE.windows.arm64.installer, RELEASE.windows.arm64.portable]
  : [];

/** Every file in this release, in the order the download page lists fingerprints. */
export const ALL_FILES: Download[] = [
  RELEASE.android,
  RELEASE.linux,
  ...WINDOWS_FILES,
  ...(RELEASE.mac ? [RELEASE.mac.arm64, RELEASE.mac.x64] : []),
  ...(RELEASE.ios ? [RELEASE.ios] : []),
];

/** The platforms this release ships for, e.g. ["Android", "Linux", "Windows"]. */
export const PLATFORM_LIST: string[] = [
  "Android",
  "Linux",
  ...(RELEASE.windows ? ["Windows"] : []),
  ...(RELEASE.mac ? ["macOS"] : []),
  ...(RELEASE.ios ? ["iPhone"] : []),
];

/** "Android, Linux and Windows" — the platforms this release ships for. */
export const PLATFORMS = PLATFORM_LIST.length > 1
  ? `${PLATFORM_LIST.slice(0, -1).join(", ")} and ${PLATFORM_LIST[PLATFORM_LIST.length - 1]}`
  : PLATFORM_LIST[0];

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Privacy" },
  { href: "/why-kant", label: "Why Kant" },
  { href: "/community", label: "Community" },
];
