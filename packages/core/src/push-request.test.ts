import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSodium } from './sodium.js';
import { signPushRequest } from './index.js';

// The relay verifies these exact strings (packages/relay/src/pushAuth.ts).
test('push requests are signed by the identity over the relay\'s domain-separated strings', async () => {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  const identity = { publicKeyHex: sodium.to_hex(kp.publicKey), privateKey: kp.privateKey };
  const verify = (sig: string, message: string) =>
    sodium.crypto_sign_verify_detached(sodium.from_hex(sig), new TextEncoder().encode(message), kp.publicKey);

  const sub = await signPushRequest(identity, { type: 'fcm', token: 't0k3n' }) as any;
  assert.equal(sub.identityKeyHex, identity.publicKeyHex);
  assert.equal(sub.type, 'fcm');
  assert.equal(sub.token, 't0k3n');
  assert.match(sub.nonce, /^[0-9a-f]{32}$/);
  assert.ok(Math.abs(Date.now() - sub.timestamp) < 5000);
  assert.equal(verify(sub.sig, `kant-push-subscribe|${sub.timestamp}|${sub.nonce}|fcm|t0k3n`), true);

  const unsub = await signPushRequest(identity) as any;
  assert.equal(unsub.token, undefined);
  assert.notEqual(unsub.nonce, sub.nonce);
  assert.equal(verify(unsub.sig, `kant-push-unsubscribe|${unsub.timestamp}|${unsub.nonce}`), true);
});
