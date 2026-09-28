/**
 * When a fingerprint may stand in for the password, and when Kant locks
 * itself. Pure, so it is unit-tested (securityPolicy.test.ts); storage and the
 * native plugin live in biometric.ts.
 */

export interface SecurityPrefs {
  /** Lock after the app has been in the background this long. 0 = never. */
  autoLockMs: number;
  /** Ask for the password again once this long has passed since the last one. */
  passwordEveryMs: number;
}

export const AUTO_LOCK_CHOICES = [0, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
export const PASSWORD_EVERY_CHOICES = [24 * 3600_000, 3 * 24 * 3600_000, 7 * 24 * 3600_000] as const;
export const DEFAULT_SECURITY_PREFS: SecurityPrefs = { autoLockMs: 0, passwordEveryMs: 3 * 24 * 3600_000 };

/** Wrong-finger rounds (each already several tries) before only the password works. */
export const MAX_BIOMETRIC_FAILURES = 3;
/** Boot times reported by the OS wobble by a few ms; a restart moves them by far more. */
const BOOT_TOLERANCE_MS = 60_000;

/** Remembered about the last password unlock — never anything secret. */
export interface BiometricGate {
  lastPasswordAt: number;
  /** The device's boot time then, when the platform reports one. */
  bootTimeAtPassword?: number;
  /** Biometric attempts that failed since that password unlock. */
  failures: number;
}

export type BiometricBlock = 'no-password-yet' | 'restarted' | 'expired' | 'too-many-failures';

/** Why the fingerprint can't be used right now, or null when it can. */
export function biometricBlocked(
  gate: BiometricGate | null, now: number, bootTime: number | undefined, prefs: SecurityPrefs,
): BiometricBlock | null {
  if (!gate || !gate.lastPasswordAt) return 'no-password-yet';
  if (bootTime !== undefined && gate.bootTimeAtPassword !== undefined
    && Math.abs(bootTime - gate.bootTimeAtPassword) > BOOT_TOLERANCE_MS) return 'restarted';
  if (now - gate.lastPasswordAt > prefs.passwordEveryMs || now < gate.lastPasswordAt) return 'expired';
  if (gate.failures >= MAX_BIOMETRIC_FAILURES) return 'too-many-failures';
  return null;
}

export function blockMessage(block: BiometricBlock): string {
  switch (block) {
    case 'restarted': return 'Your phone restarted, so enter your password once.';
    case 'expired': return 'It’s been a while — enter your password once.';
    case 'too-many-failures': return 'Fingerprint didn’t match too many times. Enter your password.';
    default: return 'Enter your password.';
  }
}

/** Whether the app should lock on coming back after `hiddenAt`. */
export function shouldAutoLock(hiddenAt: number | null, now: number, prefs: SecurityPrefs): boolean {
  return prefs.autoLockMs > 0 && hiddenAt !== null && now - hiddenAt >= prefs.autoLockMs;
}

export function sanitizeSecurityPrefs(raw: unknown): SecurityPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const autoLockMs = (AUTO_LOCK_CHOICES as readonly number[]).includes(r.autoLockMs as number) ? r.autoLockMs as number : DEFAULT_SECURITY_PREFS.autoLockMs;
  const passwordEveryMs = (PASSWORD_EVERY_CHOICES as readonly number[]).includes(r.passwordEveryMs as number)
    ? r.passwordEveryMs as number : DEFAULT_SECURITY_PREFS.passwordEveryMs;
  return { autoLockMs, passwordEveryMs };
}
