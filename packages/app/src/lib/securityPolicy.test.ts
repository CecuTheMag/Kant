import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_SECURITY_PREFS, biometricBlocked, sanitizeSecurityPrefs, shouldAutoLock } from './securityPolicy';

const H = 3600_000;
const prefs = DEFAULT_SECURITY_PREFS;

describe('biometric gate', () => {
  test('needs one password unlock first', () => {
    assert.equal(biometricBlocked(null, 1, 0, prefs), 'no-password-yet');
  });
  test('allowed within the window on the same boot', () => {
    assert.equal(biometricBlocked({ lastPasswordAt: 1000, bootTimeAtPassword: 500, failures: 0 }, 1000 + 2 * H, 520, prefs), null);
  });
  test('a restart asks for the password', () => {
    assert.equal(biometricBlocked({ lastPasswordAt: 1000, bootTimeAtPassword: 500, failures: 0 }, 2000, 500 + 10 * H, prefs), 'restarted');
  });
  test('after the chosen time the password is needed again', () => {
    assert.equal(biometricBlocked({ lastPasswordAt: 1000, failures: 0 }, 1000 + 4 * 24 * H, undefined, prefs), 'expired');
    assert.equal(biometricBlocked({ lastPasswordAt: 1000, failures: 0 }, 500, undefined, prefs), 'expired'); // clock went back
  });
  test('too many failures lock the fingerprint out', () => {
    assert.equal(biometricBlocked({ lastPasswordAt: 1000, failures: 3 }, 2000, undefined, prefs), 'too-many-failures');
  });
});

describe('auto-lock', () => {
  test('locks only after the chosen time in the background', () => {
    const p = { ...prefs, autoLockMs: 60_000 };
    assert.equal(shouldAutoLock(0, 59_999, p), false);
    assert.equal(shouldAutoLock(0, 60_000, p), true);
    assert.equal(shouldAutoLock(null, 10 * H, p), false);
    assert.equal(shouldAutoLock(0, 10 * H, prefs), false); // never
  });
  test('stored preferences are validated', () => {
    assert.deepEqual(sanitizeSecurityPrefs({ autoLockMs: 7, passwordEveryMs: 'x' }), DEFAULT_SECURITY_PREFS);
    assert.equal(sanitizeSecurityPrefs({ autoLockMs: 300_000 }).autoLockMs, 300_000);
  });
});
