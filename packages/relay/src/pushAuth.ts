/**
 * Authentication and validation for /push/subscribe and /push/unsubscribe.
 *
 * A push registration decides which device the relay wakes when someone looks
 * up an identity, so only the identity itself may set or remove it: requests
 * carry an Ed25519 signature by the identity key over a message that names the
 * action, so it can never be replayed as a /register or /lookup signature (or
 * the other way round). Clients build the same strings in signPushRequest
 * (packages/core/src/index.ts).
 *
 * Web Push subscriptions also name the URL the relay will POST to. Only https
 * endpoints of the browser push services are accepted, so a subscription can
 * never point the relay at an internal address.
 */

export const PUSH_MAX_BODY = 8192;
export const PUSH_MAX_TOKEN = 4096;

export type PushType = 'fcm' | 'webpush';

export function pushSubscribeMessage(timestamp: number, nonce: string, type: string, token: string): string {
  return `kant-push-subscribe|${timestamp}|${nonce}|${type}|${token}`;
}

export function pushUnsubscribeMessage(timestamp: number, nonce: string): string {
  return `kant-push-unsubscribe|${timestamp}|${nonce}`;
}

/** Hosts (or host suffixes, with a leading dot) of the Web Push services browsers use. */
const WEBPUSH_HOSTS = [
  'fcm.googleapis.com',               // Chrome, Edge (Chromium), Brave, Opera, Samsung Internet
  'android.googleapis.com',           // legacy GCM endpoints still issued to old Chrome installs
  'updates.push.services.mozilla.com', // Firefox
  '.push.apple.com',                  // Safari (web.push.apple.com)
  '.notify.windows.com',              // Edge legacy (WNS)
];

export function isAllowedWebPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return WEBPUSH_HOSTS.some(h => h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h);
}

export interface WebPushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }

/** A Web Push subscription (PushSubscription.toJSON()) the relay can safely send to, or null. */
export function parseWebPushSubscription(token: string): WebPushSubscription | null {
  let sub: any;
  try { sub = JSON.parse(token); } catch { return null; }
  if (!sub || typeof sub !== 'object' || !isAllowedWebPushEndpoint(sub.endpoint)) return null;
  const b64url = /^[A-Za-z0-9_-]{1,256}={0,2}$/;
  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== 'string' || !b64url.test(p256dh) || typeof auth !== 'string' || !b64url.test(auth)) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}

export interface PushRequestCheck {
  identityKeyHex: string;
  timestamp: number;
  nonce: string;
  sig: Uint8Array;
}

/**
 * The shared fields of a push request, validated, or a reason it is refused.
 * The caller still checks the nonce against its replay set and the signature.
 */
export function readPushRequest(data: any, now: number, sodium: any): PushRequestCheck | { error: string } {
  if (!data || typeof data !== 'object') return { error: 'missing fields' };
  const { identityKeyHex, timestamp, nonce, sig } = data;
  if (typeof identityKeyHex !== 'string' || !/^[0-9a-f]{64}$/.test(identityKeyHex)) return { error: 'identityKeyHex must be 64 lowercase hex characters' };
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)) return { error: 'missing fields' };
  if (Math.abs(now - timestamp) > 60_000) return { error: 'timestamp too old or in the future' };
  if (typeof nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(nonce)) return { error: 'missing fields' };
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return { error: 'missing fields' };
  return { identityKeyHex, timestamp, nonce, sig: sodium.from_hex(sig) };
}

export function verifyPushSignature(sodium: any, identityKeyHex: string, message: string, sig: Uint8Array): boolean {
  try {
    return sodium.crypto_sign_verify_detached(sig, new TextEncoder().encode(message), sodium.from_hex(identityKeyHex));
  } catch {
    return false;
  }
}
