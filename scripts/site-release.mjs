#!/usr/bin/env node
// Point the website's downloads at a GitHub release.
//
//   node scripts/site-release.mjs 0.7.0-beta
//
// Reads the release's files and SHA256SUMS.txt with the GitHub CLI (`gh`,
// signed in; a draft release works too) and rewrites the RELEASE block of
// packages/site/src/lib/config.ts: version, date, file names, sizes and
// SHA-256s. A platform missing from the release is set to null, which the site
// shows as "not yet". Review the diff, then commit and deploy the site.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2];
if (!tag || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
  console.error('usage: node scripts/site-release.mjs <tag>   e.g. 0.7.0-beta');
  process.exit(1);
}
const version = tag.split('-')[0];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'packages/site/src/lib/config.ts');

const gh = (...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' });
const release = JSON.parse(gh('release', 'view', tag, '--json', 'assets,publishedAt,isDraft'));
const sizes = new Map(release.assets.map(a => [a.name, a.size]));
const sums = new Map(
  gh('release', 'download', tag, '--pattern', 'SHA256SUMS.txt', '--output', '-')
    .trim().split('\n')
    .map(line => line.trim().split(/\s+\*?/))
    .map(([hash, name]) => [name, hash]),
);

// Decimal megabytes, as the site has always shown them: "5.8 MB", "119 MB".
const mb = bytes => {
  const value = bytes / 1_000_000;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} MB`;
};

const missing = [];
function file(name) {
  if (!sizes.has(name) || !sums.has(name)) { missing.push(name); return null; }
  const hash = sums.get(name);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`bad SHA-256 for ${name} in SHA256SUMS.txt`);
  return [
    `{`,
    `  file: "${name}",`,
    `  url: \`\${releaseBase}/${name}\`,`,
    `  size: "${mb(sizes.get(name))}",`,
    `  sha256: "${hash}",`,
    `}`,
  ].join('\n');
}
const indent = (text, by) => text.split('\n').map((l, i) => (i ? ' '.repeat(by) + l : l)).join('\n');

const android = file(`Kant-${version}.apk`);
const linux = file(`Kant-${version}.AppImage`);
if (!android || !linux) {
  console.error(`The release has no ${missing.join(' or ')} (or no checksum for it). Nothing changed.`);
  process.exit(1);
}
const win = {
  x64i: file(`Kant-Setup-${version}-x64.exe`), x64p: file(`Kant-${version}-x64-portable.exe`),
  armi: file(`Kant-Setup-${version}-arm64.exe`), armp: file(`Kant-${version}-arm64-portable.exe`),
};
const windows = Object.values(win).every(Boolean)
  ? `{
    x64: {
      installer: ${indent(win.x64i, 6)},
      portable: ${indent(win.x64p, 6)},
    },
    arm64: {
      installer: ${indent(win.armi, 6)},
      portable: ${indent(win.armp, 6)},
    },
  }`
  : 'null';
const macArm = file(`Kant-${version}-mac-arm64.dmg`);
const macX64 = file(`Kant-${version}-mac-x64.dmg`);
const mac = macArm && macX64
  ? `{
    arm64: ${indent(macArm, 4)},
    x64: ${indent(macX64, 4)},
  }`
  : 'null';
const ios = file(`Kant-${version}.ipa`) ?? 'null';

const date = (release.publishedAt ?? new Date().toISOString()).slice(0, 10);

const block = `const releaseBase = \`\${SITE.githubUrl}/releases/download/${tag}\`;

export type Download = { file: string; url: string; size: string; sha256: string };
type WindowsDownloads = Record<"x64" | "arm64", { installer: Download; portable: Download }>;
type MacDownloads = Record<"arm64" | "x64", Download>;

export const RELEASE = {
  version: "${version}",
  channel: "Beta",
  date: "${date}",
  notesUrl: \`\${SITE.githubUrl}/releases/latest\`,
  android: ${indent(android, 2)},
  linux: ${indent(linux, 2)},
  // Windows builds come from the release workflow (0.5.0 on): an installer and
  // a portable exe for each architecture. Leave null for a release without
  // them and the site shows Windows as "not yet".
  windows: ${windows} as WindowsDownloads | null,
  // macOS DMGs (Apple Silicon and Intel) and the iPhone .ipa, from the release
  // workflow (0.6.0 on). Leave null for a release without them and the site
  // shows them as "coming later".
  mac: ${mac} as MacDownloads | null,
  ios: ${indent(ios, 2)} as Download | null,
};
`;

const source = readFileSync(configPath, 'utf8');
const start = source.indexOf('const releaseBase');
const end = source.indexOf('/** Every Windows file');
if (start < 0 || end < 0 || end < start) throw new Error('could not find the RELEASE block in config.ts');
writeFileSync(configPath, source.slice(0, start) + block + '\n' + source.slice(end));

console.log(`Website downloads now point at ${tag} (${date}).`);
if (missing.length) console.log(`Not in the release, shown as "not yet": ${missing.join(', ')}`);
if (release.isDraft) console.log('The release is still a draft: publish it before deploying the site, or the links will not work.');
console.log('Review: git diff packages/site/src/lib/config.ts');
