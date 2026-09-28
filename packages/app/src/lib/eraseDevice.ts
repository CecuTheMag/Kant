/**
 * "Delete everything on this device" — the single implementation behind both
 * Settings → Erase and the unlock screen's forgotten-password path.
 */
import { DB_NAME, wipeIdentity } from '@kant/core';
import { clearTemporaryFiles } from './fileActions';
import { disableBiometric } from './biometric';

/**
 * Device preferences that identify nobody and that a fresh start should keep:
 * the theme, the Terms version already accepted, and whether onion routing is
 * on (resetting that would quietly lower privacy for the next identity).
 */
const KEEP_LOCAL_KEYS = new Set(['kant_theme', 'kant_terms_accepted_version', 'kant_onion_enabled']);

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Another tab holds it open; the per-store wipe already ran, so don't hang.
    req.onblocked = () => resolve();
  });
}

/**
 * Erase identity, contacts, messages, files, sessions and every locally stored
 * setting that could identify the user (profile name, relay, AI settings,
 * pending invites), plus any temporary plaintext copies. Throws only if the
 * database could be neither cleared nor deleted — the caller must not tell the
 * user their data is gone in that case.
 */
export async function eraseAllLocalData(options: { keep?: string[] } = {}): Promise<void> {
  const keep = new Set([...KEEP_LOCAL_KEYS, ...(options.keep ?? [])]);
  // The fingerprint key wraps the erased identity's key: it must go too.
  await disableBiometric().catch(() => {});
  try {
    await wipeIdentity();
  } catch {
    await deleteDatabase();
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (!keep.has(key)) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable — nothing stored there either */ }
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  await clearTemporaryFiles().catch(() => {});
}
