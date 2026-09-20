import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

function toBase64(data: Uint8Array): string {
  let binary = '';
  const block = 0x4000;
  for (let i = 0; i < data.length; i += block) {
    binary += String.fromCharCode(...data.subarray(i, Math.min(i + block, data.length)));
  }
  return btoa(binary);
}

function safeName(fileName: string, fileId: string): string {
  const cleaned = fileName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim() || 'attachment';
  const dot = cleaned.lastIndexOf('.');
  const suffix = `-${fileId.slice(0, 8)}`;
  return dot > 0
    ? `${cleaned.slice(0, dot)}${suffix}${cleaned.slice(dot)}`
    : `${cleaned}${suffix}`;
}

/**
 * Read a File's bytes in a way that works on Android WebView.
 *
 * `file.arrayBuffer()` silently returns 0 bytes for content:// URIs on some
 * Android WebView versions. Reading via fetch(objectURL) goes through the
 * browser's blob URL handler which correctly resolves the content URI.
 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return new Uint8Array(await file.arrayBuffer());
  }
  const url = URL.createObjectURL(file);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch blob failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save a decrypted attachment through Android's native filesystem API. */
export async function exportAndroidFile(
  fileId: string,
  fileName: string,
  data: Uint8Array,
): Promise<string | null> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;

  // Filesystem performs the runtime request only on Android 10 and below.
  // Android 11+ uses scoped storage and must not be blocked on legacy grants.
  const result = await Filesystem.writeFile({
    path: `Kant/${safeName(fileName, fileId)}`,
    data: toBase64(data.subarray(0, Math.min(512 * 1024, data.length))),
    directory: Directory.Documents,
    recursive: true,
  });

  // Keep bridge payloads bounded. A single base64 string for a 100 MB file can
  // exhaust Android WebView memory even though the transfer itself succeeded.
  for (let offset = 512 * 1024; offset < data.length; offset += 512 * 1024) {
    await Filesystem.appendFile({
      path: `Kant/${safeName(fileName, fileId)}`,
      data: toBase64(data.subarray(offset, Math.min(offset + 512 * 1024, data.length))),
      directory: Directory.Documents,
    });
  }
  return result.uri;
}
