import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import {
  isAllowedWebPushEndpoint, parseWebPushSubscription, pushSubscribeMessage, pushUnsubscribeMessage,
  readPushRequest, verifyPushSignature,
} from './pushAuth.js';

const sodium: any = createRequire(import.meta.url)('libsodium-wrappers-sumo');

async function signer() {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  const hex: string = sodium.to_hex(kp.publicKey);
  const sign = (message: string) => sodium.to_hex(sodium.crypto_sign_detached(new TextEncoder().encode(message), kp.privateKey)) as string;
  return { hex, sign };
}

test('a push registration is accepted only with the identity\'s own signature over that exact request', async () => {
  const alice = await signer();
  const mallory = await signer();
  const now = Date.now();
  const nonce = 'ab'.repeat(16);
  const token = 'fcm-token-of-alice';
  const message = pushSubscribeMessage(now, nonce, 'fcm', token);
  const request = readPushRequest({ identityKeyHex: alice.hex, timestamp: now, nonce, sig: alice.sign(message) }, now, sodium);
  assert.ok(!('error' in request));
  assert.equal(verifyPushSignature(sodium, alice.hex, message, request.sig), true);

  // Mallory cannot claim Alice's identity, swap in her own token, or turn a
  // subscribe signature into an unsubscribe.
  assert.equal(verifyPushSignature(sodium, alice.hex, message, sodium.from_hex(mallory.sign(message))), false);
  assert.equal(verifyPushSignature(sodium, alice.hex, pushSubscribeMessage(now, nonce, 'fcm', 'mallory-token'), request.sig), false);
  assert.equal(verifyPushSignature(sodium, alice.hex, pushUnsubscribeMessage(now, nonce), request.sig), false);
  // Never valid as a /register or /lookup signature either: those start with the timestamp.
  assert.ok(!message.startsWith(String(now)) && !pushUnsubscribeMessage(now, nonce).startsWith(String(now)));
});

test('push requests with stale, missing or malformed fields are refused before any signature check', async () => {
  const alice = await signer();
  const now = Date.now();
  const ok = { identityKeyHex: alice.hex, timestamp: now, nonce: 'ab'.repeat(16), sig: 'cd'.repeat(64) };
  assert.ok(!('error' in readPushRequest(ok, now, sodium)));
  for (const bad of [
    null,
    { ...ok, identityKeyHex: undefined },
    { ...ok, identityKeyHex: alice.hex.toUpperCase() },
    { ...ok, identityKeyHex: alice.hex.slice(2) },
    { ...ok, timestamp: now - 61_000 },
    { ...ok, timestamp: now + 61_000 },
    { ...ok, timestamp: String(now) },
    { ...ok, nonce: 'short' },
    { ...ok, sig: 'cd'.repeat(10) },
    { ...ok, sig: Array.from({ length: 64 }, () => 1) },
  ]) {
    assert.ok('error' in readPushRequest(bad, now, sodium), JSON.stringify(bad));
  }
});

test('web push endpoints must be https URLs of a browser push service', () => {
  for (const good of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://db5p.notify.windows.com/w/?token=abc',
  ]) assert.equal(isAllowedWebPushEndpoint(good), true, good);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/admin',
    'https://localhost:3001/admin/reservations',
    'https://push-proxy:4001/wake',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com.evil.example/x',
    'https://push.apple.com/',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'file:///etc/passwd',
    'not a url',
    42,
  ]) assert.equal(isAllowedWebPushEndpoint(bad), false, String(bad));
});

test('web push subscriptions are parsed strictly', () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  assert.deepEqual(parseWebPushSubscription(JSON.stringify(sub)), sub);
  assert.equal(parseWebPushSubscription(JSON.stringify({ ...sub, endpoint: 'https://10.0.0.5/x' })), null);
  assert.equal(parseWebPushSubscription(JSON.stringify({ ...sub, keys: { p256dh: '<script>', auth: 'x' } })), null);
  assert.equal(parseWebPushSubscription(JSON.stringify({ endpoint: sub.endpoint })), null);
  assert.equal(parseWebPushSubscription('{nope'), null);
});
