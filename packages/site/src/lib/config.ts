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

const releaseBase = `${SITE.githubUrl}/releases/download/0.6.0-beta`;

export type Download = { file: string; url: string; size: string; sha256: string };
type WindowsDownloads = Record<"x64" | "arm64", { installer: Download; portable: Download }>;
type MacDownloads = Record<"arm64" | "x64", Download>;

export const RELEASE = {
  version: "0.6.0",
  channel: "Beta",
  date: "2026-10-07",
  notesUrl: `${SITE.githubUrl}/releases/latest`,
  android: {
    file: "Kant-0.6.0.apk",
    url: `${releaseBase}/Kant-0.6.0.apk`,
    size: "5.8 MB",
    sha256: "f6bf2b4649cc2e82dadc74bcb05c9688c664a692f3a8af95b7be7d2a32fd5e1a",
  },
  linux: {
    file: "Kant-0.6.0.AppImage",
    url: `${releaseBase}/Kant-0.6.0.AppImage`,
    size: "119 MB",
    sha256: "f6ba10cedccb485204c405465f108bdaa123186c389ae91f599d1980dcf2212a",
  },
  // Windows builds come from the release workflow (0.5.0 on): an installer and
  // a portable exe for each architecture. Leave null for a release without
  // them and the site shows Windows as "not yet".
  windows: {
    x64: {
      installer: {
        file: "Kant-Setup-0.6.0-x64.exe",
        url: `${releaseBase}/Kant-Setup-0.6.0-x64.exe`,
        size: "92 MB",
        sha256: "59a2f2ef25b309f2cee3ec2519926b601a119816965bc2519936ee46eb3b92d2",
      },
      portable: {
        file: "Kant-0.6.0-x64-portable.exe",
        url: `${releaseBase}/Kant-0.6.0-x64-portable.exe`,
        size: "91 MB",
        sha256: "3a3898db2010d0d9938500afa9578c8290d857b52f057169fb6cb75db774f94a",
      },
    },
    arm64: {
      installer: {
        file: "Kant-Setup-0.6.0-arm64.exe",
        url: `${releaseBase}/Kant-Setup-0.6.0-arm64.exe`,
        size: "98 MB",
        sha256: "303cb11f60a1de4aefa33be8f4c1a4143bcb7fdfc97024948de7a1a62bb7dcc9",
      },
      portable: {
        file: "Kant-0.6.0-arm64-portable.exe",
        url: `${releaseBase}/Kant-0.6.0-arm64-portable.exe`,
        size: "98 MB",
        sha256: "8f181d0a07ce2f139dc463040082a3dac022209ddc0a804f2d00c4b1f542be4c",
      },
    },
  } as WindowsDownloads | null,
  // macOS DMGs (Apple Silicon and Intel) and the iPhone .ipa, from the release
  // workflow (0.6.0 on). Leave null for a release without them and the site
  // shows them as "coming later".
  mac: {
    arm64: {
      file: "Kant-0.6.0-mac-arm64.dmg",
      url: `${releaseBase}/Kant-0.6.0-mac-arm64.dmg`,
      size: "111 MB",
      sha256: "4c7e3d6688e2c453c4d022caa8307e790166c1d444d4b481bd9c2fd49d0a62e1",
    },
    x64: {
      file: "Kant-0.6.0-mac-x64.dmg",
      url: `${releaseBase}/Kant-0.6.0-mac-x64.dmg`,
      size: "117 MB",
      sha256: "c25a145853782077dd9622d5cd3d5999495c6599adf791b1a24079f3bf38318a",
    },
  } as MacDownloads | null,
  ios: {
    file: "Kant-0.6.0.ipa",
    url: `${releaseBase}/Kant-0.6.0.ipa`,
    size: "2.3 MB",
    sha256: "e71c7fe501fa0b23ec701f9848f17f66fb6f535be6145d0310297b146cd29642",
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
