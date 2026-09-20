/**
 * Kant License — offline-verified Ed25519-signed license keys.
 *
 * No phone-home. License key is a base64url-encoded JSON payload signed
 * by the Kant developer's Ed25519 key. Verified locally on app launch.
 *
 * Format: KANT-L-<base64url(json)>
 *
 * Community mode: no license key needed. Features are limited.
 * Enterprise mode: valid license key unlocks features.
 */

import { getSodium } from './sodium.js';

// ── Developer Public Key ──────────────────────────────────────────────────────
// This is the Kant project's Ed25519 public key, used to verify license
// signatures. Generated once, hardcoded in source.
// TODO: Replace with real dev key before release.
const DEV_PUBLIC_KEY_HEX = '0000000000000000000000000000000000000000000000000000000000000000';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LicenseTier = 'community' | 'professional' | 'enterprise';

export interface LicenseFeatures {
  maxGroups: number;           // -1 = unlimited
  maxGroupMembers: number;
  maxFileSizeBytes: number;    // bytes
  maxDevices: number;          // -1 = unlimited
  maxAIAgents: number;         // -1 = unlimited
  adminNode: boolean;
  auditLog: boolean;
  remoteWipe: boolean;
  customBranding: boolean;
  onionHops: number;           // 2 or 3
  torHiddenService: boolean;
  messageTTLDays: number;      // -1 = keep forever
}

export interface License {
  version: 1;
  tier: LicenseTier;
  licensee: string;            // org name or "Community"
  issuedTo: string;            // email or pubkey hex
  issuedAt: number;            // Unix ms
  expiresAt: number;           // 0 = never
  seats: number;               // max users
  features: LicenseFeatures;
  signature: number[];         // Ed25519 detached sig over canonical JSON
}

// ── Default (Community) limits ───────────────────────────────────────────────

export const COMMUNITY_FEATURES: LicenseFeatures = {
  maxGroups: 5,
  maxGroupMembers: 20,
  maxFileSizeBytes: 100 * 1024 * 1024,    // 100 MB
  maxDevices: 2,
  maxAIAgents: 1,
  adminNode: false,
  auditLog: false,
  remoteWipe: false,
  customBranding: false,
  onionHops: 2,
  torHiddenService: false,
  messageTTLDays: 30,
};

export const PROFESSIONAL_FEATURES: LicenseFeatures = {
  maxGroups: -1,
  maxGroupMembers: 100,
  maxFileSizeBytes: 250 * 1024 * 1024,    // 250 MB
  maxDevices: 5,
  maxAIAgents: 5,
  adminNode: false,
  auditLog: false,
  remoteWipe: false,
  customBranding: true,
  onionHops: 3,
  torHiddenService: true,
  messageTTLDays: 365,
};

export const ENTERPRISE_FEATURES: LicenseFeatures = {
  maxGroups: -1,
  maxGroupMembers: -1,
  maxFileSizeBytes: 1024 * 1024 * 1024,   // 1 GB
  maxDevices: -1,
  maxAIAgents: -1,
  adminNode: true,
  auditLog: true,
  remoteWipe: true,
  customBranding: true,
  onionHops: 3,
  torHiddenService: true,
  messageTTLDays: -1,
};

// ── Active license state ──────────────────────────────────────────────────────

let activeLicense: License | null = null;

export function getActiveLicense(): License | null {
  return activeLicense;
}

export function getActiveFeatures(): LicenseFeatures {
  return activeLicense?.features ?? COMMUNITY_FEATURES;
}

export function isFeatureAvailable<K extends keyof LicenseFeatures>(feature: K): boolean {
  const features = getActiveFeatures();
  const val = features[feature];
  if (typeof val === 'boolean') return val as boolean;
  if (typeof val === 'number') return val === -1 || val > 0;
  return false;
}

export function getLicenseTier(): LicenseTier {
  return activeLicense?.tier ?? 'community';
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Build the canonical JSON string that was signed.
 * Keys are sorted alphabetically for deterministic output.
 */
function canonicalLicense(l: Omit<License, 'signature'>): string {
  return JSON.stringify({
    version: l.version,
    tier: l.tier,
    licensee: l.licensee,
    issuedTo: l.issuedTo,
    issuedAt: l.issuedAt,
    expiresAt: l.expiresAt,
    seats: l.seats,
    features: JSON.parse(JSON.stringify(l.features)),
  });
}

/**
 * Verify and activate a license key string.
 * Returns the License on success, null on invalid/expired.
 */
export async function verifyLicense(licenseKey: string): Promise<License | null> {
  const sodium = await getSodium();

  // Strip prefix
  const b64 = licenseKey.replace(/^KANT-L-/, '');
  if (b64 === licenseKey) {
    console.warn('[license] missing KANT-L- prefix');
    return null;
  }

  // Decode base64url
  let json: License;
  try {
    const decoded = Buffer.from(b64, 'base64url').toString('utf-8');
    json = JSON.parse(decoded);
  } catch {
    console.warn('[license] invalid base64/JSON');
    return null;
  }

  // Validate structure
  if (json.version !== 1) {
    console.warn('[license] unsupported version:', json.version);
    return null;
  }
  if (!json.tier || !json.licensee || !json.issuedTo || !json.features || !json.signature) {
    console.warn('[license] missing required fields');
    return null;
  }

  // Verify signature
  const canonical = canonicalLicense(json);
  const sigBytes = new Uint8Array(json.signature);
  const devPubKey = sodium.from_hex(DEV_PUBLIC_KEY_HEX);

  // The dev public key is still the placeholder. Fail CLOSED: without a real
  // signing key we cannot verify anything, so we refuse to activate any license
  // (dropping to community mode) — unless an operator explicitly opts into dev
  // mode via KANT_LICENSE_ALLOW_DEV, which must never be set in a release build.
  if (DEV_PUBLIC_KEY_HEX === '0000000000000000000000000000000000000000000000000000000000000000') {
    const allowDev =
      typeof process !== 'undefined' && process.env?.KANT_LICENSE_ALLOW_DEV === '1';
    if (!allowDev) {
      console.warn('[license] placeholder dev key — refusing to verify license (community mode)');
      return null;
    }
    console.warn('[license] DEV MODE — signature verification skipped (KANT_LICENSE_ALLOW_DEV=1)');
  } else {
    const valid = sodium.crypto_sign_verify_detached(
      sigBytes,
      new TextEncoder().encode(canonical),
      devPubKey
    );
    if (!valid) {
      console.warn('[license] invalid signature');
      return null;
    }
  }

  // Check expiry
  if (json.expiresAt !== 0 && Date.now() > json.expiresAt) {
    console.warn('[license] expired at', new Date(json.expiresAt).toISOString());
    return null;
  }

  // Activate
  activeLicense = json;
  console.log(`[license] activated: tier=${json.tier}, licensee=${json.licensee}, seats=${json.seats}`);
  return json;
}

/**
 * Deactivate the current license (back to Community mode).
 */
export function deactivateLicense(): void {
  activeLicense = null;
  console.log('[license] deactivated — community mode');
}

/**
 * Check if license is currently valid and active.
 */
export function isLicenseActive(): boolean {
  if (!activeLicense) return false;
  if (activeLicense.expiresAt !== 0 && Date.now() > activeLicense.expiresAt) {
    return false;
  }
  return true;
}

/**
 * Get days until license expiry. Returns -1 if never expires, -2 if no license.
 */
export function daysUntilExpiry(): number {
  if (!activeLicense) return -2;
  if (activeLicense.expiresAt === 0) return -1;
  const remaining = activeLicense.expiresAt - Date.now();
  return Math.ceil(remaining / (1000 * 60 * 60 * 24));
}

/**
 * Generate a license key. Only callable by the license server (has the dev private key).
 * This function is here for reference — the actual signing happens server-side.
 */
export async function signLicense(
  license: Omit<License, 'signature'>,
  devPrivateKey: Uint8Array
): Promise<License> {
  const sodium = await getSodium();
  const canonical = canonicalLicense(license);
  const sig = sodium.crypto_sign_detached(
    new TextEncoder().encode(canonical),
    devPrivateKey
  );
  return { ...license, signature: Array.from(sig) };
}

/**
 * Encode a License object to a license key string.
 */
export function encodeLicenseKey(license: License): string {
  const json = JSON.stringify(license);
  const b64 = Buffer.from(json).toString('base64url');
  return `KANT-L-${b64}`;
}
