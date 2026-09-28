/**
 * Platform file actions: hand a decrypted attachment to another app, open an
 * external link, and clean up the temporary plaintext copies that requires.
 *
 * Capability is detected by plugin availability, never by platform name, so an
 * iOS build lights up by shipping a native plugin with the same contract:
 *
 *   Native plugin "KantFiles" (Android: KantFilesPlugin.java)
 *   ─────────────────────────────────────────────────────────────────────────
 *   openFile({ path, mimeType, title })
 *     `path` is relative to the app cache directory (Capacitor Directory.Cache:
 *     Android getCacheDir(), iOS Library/Caches) and always lies under
 *     `kant-open/`. The plugin must refuse any other path. Android shows the
 *     "Open with" chooser through a FileProvider URI with a read-only grant;
 *     iOS should present UIDocumentInteractionController / the share sheet.
 *     Rejects with code "NO_APP" when nothing on the device can open the type.
 *   openUrl({ url })
 *     Opens an http(s)/mailto URL in the system handler. The plugin re-checks
 *     the scheme; the JS side has already applied isSafeExternalUrl.
 *   clearTemp({ olderThanMs })
 *     Deletes everything under cache/kant-open older than the given age
 *     (0 = everything). The plugin also sweeps on its own at cold start and on
 *     resume, so a crash can never leave plaintext behind for long.
 *
 * Plaintext only touches disk for "Open with…", because another app can only
 * read a real file. In-app previews decrypt to memory and never write.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { isSafeExternalUrl, safeFileName, sanitizeMime } from '../ui/preview/sanitize';

interface KantFilesPlugin {
  openFile(options: { path: string; mimeType: string; title: string }): Promise<void>;
  openUrl(options: { url: string }): Promise<void>;
  clearTemp(options: { olderThanMs: number }): Promise<void>;
}

const KantFiles = registerPlugin<KantFilesPlugin>('KantFiles');

/** Must match TEMP_DIR in the native plugins. */
const TEMP_DIR = 'kant-open';
/** Bridge payloads stay small: one base64 string for a 100 MB file exhausts WebView memory. */
const CHUNK = 512 * 1024;

export type OpenResult = 'opened' | 'no-app' | 'unavailable';

function nativeFiles(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('KantFiles');
}

/** Whether "Open with…" exists on this platform (Android now; iOS once its plugin ships). */
export function canOpenExternally(): boolean {
  return nativeFiles();
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x4000) {
    binary += String.fromCharCode(...data.subarray(i, Math.min(i + 0x4000, data.length)));
  }
  return btoa(binary);
}

function randomDirName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Write the plaintext to a fresh random directory in the app cache and ask the
 * OS to open it. The per-open directory keeps the original file name (viewer
 * apps show it) without collisions. On any failure the copy is removed at once.
 */
export async function openExternally(name: string, mime: string, data: Uint8Array): Promise<OpenResult> {
  if (!nativeFiles()) return 'unavailable';
  const dir = `${TEMP_DIR}/${randomDirName()}`;
  const path = `${dir}/${safeFileName(name)}`;
  try {
    await Filesystem.writeFile({
      path, directory: Directory.Cache, recursive: true,
      data: toBase64(data.subarray(0, Math.min(CHUNK, data.length))),
    });
    for (let offset = CHUNK; offset < data.length; offset += CHUNK) {
      await Filesystem.appendFile({
        path, directory: Directory.Cache,
        data: toBase64(data.subarray(offset, Math.min(offset + CHUNK, data.length))),
      });
    }
    await KantFiles.openFile({ path, mimeType: sanitizeMime(mime), title: 'Open with' });
    return 'opened';
  } catch (error) {
    await Filesystem.rmdir({ path: dir, directory: Directory.Cache, recursive: true }).catch(() => {});
    if ((error as { code?: string })?.code === 'NO_APP') return 'no-app';
    throw error;
  }
}

/** Open a vetted http(s)/mailto link outside the app. Returns false if refused. */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isSafeExternalUrl(url)) return false;
  if (nativeFiles()) {
    await KantFiles.openUrl({ url });
    return true;
  }
  // Web: a new browsing context with no opener. Electron's window-open handler
  // routes this to the system browser (and re-checks the scheme).
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** Remove every temporary plaintext copy made for "Open with…". */
export async function clearTemporaryFiles(): Promise<void> {
  if (!nativeFiles()) return;
  await KantFiles.clearTemp({ olderThanMs: 0 });
}
