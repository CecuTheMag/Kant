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

export type Download = { file: string; url: string; size: string; sha256: string };
type WindowsDownloads = Record<"x64" | "arm64", { installer: Download; portable: Download }>;
type MacDownloads = Record<"arm64" | "x64", Download>;

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
    size: "119 MB",
    sha256: "e8a92a43313909ab879a4fcfefd16a7b805115ab596a5a58ff011f21003a7fdb",
  },
  // Windows builds come from the release workflow (0.5.0 on): an installer and
  // a portable exe for each architecture. Leave null for a release without
  // them and the site shows Windows as "not yet".
  windows: {
    x64: {
      installer: {
        file: "Kant-Setup-0.5.0-x64.exe",
        url: `${releaseBase}/Kant-Setup-0.5.0-x64.exe`,
        size: "92 MB",
        sha256: "27d4c397afc71c7e3e76af29f3506910546086839a1054f3050152caa7fec56d",
      },
      portable: {
        file: "Kant-0.5.0-x64-portable.exe",
        url: `${releaseBase}/Kant-0.5.0-x64-portable.exe`,
        size: "91 MB",
        sha256: "e75eb8e1dd210b2290cc283fce8a5c11675058dea0477f7b2f25f394024bc9e5",
      },
    },
    arm64: {
      installer: {
        file: "Kant-Setup-0.5.0-arm64.exe",
        url: `${releaseBase}/Kant-Setup-0.5.0-arm64.exe`,
        size: "98 MB",
        sha256: "7695e1ca8c6790a6e46e172d8423767d6578ec8e60ef4c43cae4e89ff3faf3c8",
      },
      portable: {
        file: "Kant-0.5.0-arm64-portable.exe",
        url: `${releaseBase}/Kant-0.5.0-arm64-portable.exe`,
        size: "98 MB",
        sha256: "042f93686f05f1c968a90305c6fa131a6ffa1298f17d05da68790d3a63db4f78",
      },
    },
  } as WindowsDownloads | null,
  // macOS DMGs (Apple Silicon and Intel) and the iPhone .ipa, from the release
  // workflow (0.6.0 on). Leave null for a release without them and the site
  // shows them as "coming later".
  mac: null as MacDownloads | null,
  ios: null as Download | null,
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
