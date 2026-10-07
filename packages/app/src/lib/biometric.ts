/**
 * Fingerprint / face unlock and the security preferences around it.
 *
 * Capability is detected by plugin availability, never by platform name, so
 * an iOS build lights up by shipping a native plugin with the same contract:
 *
 *   Native plugin "KantBiometric" (Android: KantBiometricPlugin.java)
 *   ─────────────────────────────────────────────────────────────────────────
 *   status() → { available, reason, enrolled, bootTime?, kind? }
 *     available: a strong biometric (Android Class 3; iOS Face ID / Touch ID)
 *     is set up on the device. reason: '' | 'not-enrolled' | 'no-hardware' |
 *     'security-update' | 'unavailable'. enrolled: Kant has a wrapped key.
 *     bootTime: wall-clock ms of the last device boot (so a restart can
 *     require the password); omit if the platform can't tell. kind: which
 *     biometric the device has — 'face-id' | 'touch-id' | 'optic-id' (iOS);
 *     omitted on Android, which is always called "fingerprint".
 *   enable({ secret, title, subtitle, cancel })
 *     secret: base64 of the 32-byte key that unlocks the identity. Create a
 *     new hardware-backed key usable only after a biometric check for every
 *     use and invalidated when biometrics change (Android: Keystore AES-GCM,
 *     setInvalidatedByBiometricEnrollment; iOS: Keychain item with
 *     SecAccessControl .biometryCurrentSet and
 *     kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly), confirm with a prompt,
 *     and store only the encrypted secret. Never write the secret in the clear.
 *   unlock({ title, subtitle, cancel }) → { secret }
 *     Prompt, then return the secret. Rejects with code CANCELLED (user
 *     chose the password), TOO_MANY_ATTEMPTS (3 wrong fingers/faces),
 *     LOCKOUT, INVALIDATED (biometrics changed — the plugin has already
 *     deleted its key), NOT_ENROLLED, UNAVAILABLE or FAILED.
 *   disable()
 *     Delete the key and the stored ciphertext.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { DEFAULT_SECURITY_PREFS, sanitizeSecurityPrefs } from './securityPolicy';
import type { BiometricGate, SecurityPrefs } from './securityPolicy';

interface KantBiometricPlugin {
  status(): Promise<{ available: boolean; reason: string; enrolled: boolean; bootTime?: number; kind?: string }>;
  enable(options: { secret: string; title?: string; subtitle?: string; cancel?: string }): Promise<void>;
  unlock(options: { title?: string; subtitle?: string; cancel?: string }): Promise<{ secret: string }>;
  disable(): Promise<void>;
}

const KantBiometric = registerPlugin<KantBiometricPlugin>('KantBiometric');

export type BiometricKind = 'fingerprint' | 'face-id' | 'touch-id' | 'optic-id';

export interface BiometricStatus { supported: boolean; available: boolean; reason: string; enrolled: boolean; bootTime?: number; kind: BiometricKind }

/** What the device's biometric is called, from the last status() — Android is always "fingerprint". */
let lastKind: BiometricKind = 'fingerprint';

/** User-facing words for the device's biometric ("Face ID" on most iPhones). */
export function biometricText(kind: BiometricKind = lastKind) {
  switch (kind) {
    case 'face-id': return {
      name: 'Face ID', Name: 'Face ID', changed: 'Your Face ID changed', notRecognised: 'Face not recognised',
      setupHint: 'Set up Face ID in your iPhone’s Settings first',
      risk: 'Anyone Face ID recognises on this phone can unlock Kant — turn Face ID unlock off if that’s a risk for you.',
    };
    case 'touch-id': return {
      name: 'Touch ID', Name: 'Touch ID', changed: 'Your Touch ID fingerprints changed', notRecognised: 'Fingerprint not recognised',
      setupHint: 'Set up Touch ID in your iPhone’s Settings first',
      risk: 'Anyone with a finger registered for Touch ID can unlock Kant — turn Touch ID unlock off if that’s a risk for you.',
    };
    case 'optic-id': return {
      name: 'Optic ID', Name: 'Optic ID', changed: 'Your Optic ID changed', notRecognised: 'Optic ID didn’t recognise you',
      setupHint: 'Set up Optic ID in Settings first',
      risk: 'Anyone Optic ID recognises on this device can unlock Kant — turn Optic ID unlock off if that’s a risk for you.',
    };
    default: return {
      name: 'fingerprint', Name: 'Fingerprint', changed: 'Your fingerprints changed', notRecognised: 'Fingerprint not recognised',
      setupHint: 'Add a fingerprint in your phone’s settings first',
      risk: 'Anyone who can use your finger can unlock Kant — turn fingerprint unlock off if that’s a risk for you.',
    };
  }
}

function toKind(raw: unknown): BiometricKind {
  return raw === 'face-id' || raw === 'touch-id' || raw === 'optic-id' ? raw : 'fingerprint';
}

export type BiometricError =
  | 'CANCELLED' | 'TOO_MANY_ATTEMPTS' | 'LOCKOUT' | 'INVALIDATED' | 'NOT_ENROLLED' | 'UNAVAILABLE' | 'FAILED';

function supported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('KantBiometric');
}

export async function biometricStatus(): Promise<BiometricStatus> {
  if (!supported()) return { supported: false, available: false, reason: 'unsupported', enrolled: false, kind: lastKind };
  try {
    const s = await KantBiometric.status();
    lastKind = toKind(s.kind);
    return { supported: true, available: !!s.available, reason: s.reason ?? '', enrolled: !!s.enrolled, bootTime: typeof s.bootTime === 'number' ? s.bootTime : undefined, kind: lastKind };
  } catch {
    return { supported: true, available: false, reason: 'unavailable', enrolled: false, kind: lastKind };
  }
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function errorCode(e: unknown): BiometricError {
  const code = (e as { code?: string })?.code;
  const known: BiometricError[] = ['CANCELLED', 'TOO_MANY_ATTEMPTS', 'LOCKOUT', 'INVALIDATED', 'NOT_ENROLLED', 'UNAVAILABLE', 'FAILED'];
  return known.includes(code as BiometricError) ? code as BiometricError : 'FAILED';
}

/** Wrap the identity key behind the fingerprint. Resolves null on success, else why not. */
export async function enableBiometric(derivedKey: Uint8Array): Promise<BiometricError | null> {
  if (!supported()) return 'UNAVAILABLE';
  try {
    await KantBiometric.enable({
      secret: toB64(derivedKey), title: `Turn on ${biometricText().name} unlock`, subtitle: 'Confirm it’s you', cancel: 'Cancel',
    });
    return null;
  } catch (e) {
    return errorCode(e);
  }
}

export async function unlockWithBiometric(): Promise<{ key: Uint8Array } | { error: BiometricError }> {
  if (!supported()) return { error: 'UNAVAILABLE' };
  try {
    const { secret } = await KantBiometric.unlock({ title: 'Unlock Kant', subtitle: '', cancel: 'Use password' });
    return { key: fromB64(secret) };
  } catch (e) {
    return { error: errorCode(e) };
  }
}

export async function disableBiometric(): Promise<void> {
  if (!supported()) return;
  try { await KantBiometric.disable(); } catch { /* nothing stored */ }
}

/* ── Stored preferences (device-local, not secret) ───────────────────── */

const PREFS_KEY = 'kant_security';
const GATE_KEY = 'kant_biometric_gate';

export function readSecurityPrefs(): SecurityPrefs {
  try { return sanitizeSecurityPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')); } catch { return { ...DEFAULT_SECURITY_PREFS }; }
}

export function writeSecurityPrefs(prefs: SecurityPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

export function readGate(): BiometricGate | null {
  try {
    const g = JSON.parse(localStorage.getItem(GATE_KEY) ?? 'null') as BiometricGate | null;
    if (!g || typeof g.lastPasswordAt !== 'number') return null;
    return { lastPasswordAt: g.lastPasswordAt, bootTimeAtPassword: typeof g.bootTimeAtPassword === 'number' ? g.bootTimeAtPassword : undefined, failures: Number(g.failures) || 0 };
  } catch {
    return null;
  }
}

export function writeGate(gate: BiometricGate | null): void {
  try {
    if (gate) localStorage.setItem(GATE_KEY, JSON.stringify(gate)); else localStorage.removeItem(GATE_KEY);
  } catch { /* storage unavailable */ }
}
