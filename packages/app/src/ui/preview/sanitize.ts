/**
 * Hardening for attacker-controlled file metadata. A received attachment's
 * name and MIME type are chosen by the sender, so neither may be trusted when
 * it is shown, written to disk, or handed to another app.
 *
 * Pure module (no DOM, no Capacitor) so it runs under `node --test`.
 */

/**
 * Bidirectional-override and other invisible formatting characters. U+202E in
 * a name like "invoice\u202Efdp.exe" displays as "invoiceexe.pdf" — a classic
 * way to disguise the real extension.
 */
const INVISIBLE_FORMATTING = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

const MAX_NAME = 120;

function stripInvisible(name: string | undefined): string {
  return (name ?? '').replace(INVISIBLE_FORMATTING, '').replace(CONTROL, '').trim();
}

/** What the UI shows. Never empty. */
export function displayFileName(name: string | undefined): string {
  return stripInvisible(name) || 'File';
}

/**
 * A single safe path segment for writing the file to disk: no separators,
 * no traversal, no hidden-file prefix, bounded length, extension preserved.
 */
export function safeFileName(name: string | undefined): string {
  let cleaned = stripInvisible(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!cleaned || cleaned === '_') cleaned = 'file';
  if (cleaned.length <= MAX_NAME) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_NAME - ext.length) + ext;
}

/** Lower-case extension without the dot, or '' when there is none. */
export function fileExtension(name: string | undefined): string {
  const cleaned = displayFileName(name);
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0 || dot === cleaned.length - 1) return '';
  const ext = cleaned.slice(dot + 1).toLowerCase();
  return /^[a-z0-9_+-]{1,15}$/.test(ext) ? ext : '';
}

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** A well-formed `type/subtype` (parameters stripped), else octet-stream. */
export function sanitizeMime(mime: string | undefined): string {
  const bare = (mime ?? '').split(';')[0].trim().toLowerCase();
  return MIME.test(bare) ? bare : 'application/octet-stream';
}

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * Only web and mail links may leave the app. Everything else — javascript:,
 * data:, file:, intent:, content:, custom schemes — is rendered as inert text.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length > 2048) return false;
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return false; }
  if (!SAFE_URL_SCHEMES.has(parsed.protocol)) return false;
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return false;
  // Credentials in the authority are a phishing tool ("https://bank.com@evil.io").
  return !parsed.username && !parsed.password;
}
