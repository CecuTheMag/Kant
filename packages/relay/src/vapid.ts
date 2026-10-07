import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VAPID keys for desktop Web Push, as base64url: the public key is the 65-byte
 * uncompressed P-256 point browsers take as applicationServerKey; the private
 * key is either the raw 32-byte scalar (what `npx web-push generate-vapid-keys`
 * and most tools print) or PKCS#8 DER (what older Kant docs produced).
 */
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export async function importVapidPrivateKey(privateKey: string, publicKey: string): Promise<webcrypto.CryptoKey> {
  const priv = Buffer.from(privateKey, 'base64url');
  if (priv.length !== 32) return webcrypto.subtle.importKey('pkcs8', priv, ALG, false, ['sign']);
  const pub = Buffer.from(publicKey, 'base64url');
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 point (65 bytes)');
  }
  return webcrypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', ext: false,
    d: priv.toString('base64url'),
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33).toString('base64url'),
  }, ALG, false, ['sign']);
}

/** Do the two keys load and belong together? Returns why not, or '' when they do. */
export async function checkVapidKeys(privateKey: string, publicKey: string): Promise<string> {
  try {
    const key = await importVapidPrivateKey(privateKey, publicKey);
    const pub = await webcrypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), ALG, false, ['verify']);
    const probe = Buffer.from('kant-vapid-check');
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, probe);
    const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, probe);
    return ok ? '' : 'VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY are not a pair';
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

/** A fresh pair in the common format (raw private scalar). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: pub.toString('base64url'), privateKey: jwk.d! };
}

// `node dist/vapid.js` prints a new pair as env lines, for the deploy scripts.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { publicKey, privateKey } = await generateVapidKeys();
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
}
