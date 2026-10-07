import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { checkVapidKeys, generateVapidKeys } from './vapid.js';

/** A pair as `npx web-push generate-vapid-keys` prints it, and the same private key as PKCS#8. */
function webPushStylePair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return {
    publicKey: pub.toString('base64url'),
    rawPrivate: jwk.d!,
    pkcs8Private: (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64url'),
    spki: publicKey,
  };
}

describe('VAPID keys', () => {
  test('the raw format web-push and most tools print is accepted', async () => {
    const k = webPushStylePair();
    assert.equal(await checkVapidKeys(k.rawPrivate, k.publicKey), '');
  });

  test('PKCS#8 private keys still work', async () => {
    const k = webPushStylePair();
    assert.equal(await checkVapidKeys(k.pkcs8Private, k.publicKey), '');
  });

  test('generated pairs are valid and in the common format', async () => {
    const { publicKey, privateKey } = await generateVapidKeys();
    assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
    assert.equal(Buffer.from(privateKey, 'base64url').length, 32);
    assert.equal(await checkVapidKeys(privateKey, publicKey), '');
  });

  test('keys that do not belong together, or are not keys, are reported', async () => {
    const a = webPushStylePair();
    const b = webPushStylePair();
    assert.match(await checkVapidKeys(a.rawPrivate, b.publicKey), /./);
    assert.match(await checkVapidKeys('not-a-key', a.publicKey), /./);
    assert.match(await checkVapidKeys(a.rawPrivate, 'short'), /uncompressed P-256/);
  });
});
