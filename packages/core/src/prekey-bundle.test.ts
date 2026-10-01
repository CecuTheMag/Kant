import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSodium } from './sodium.js';
import { buildPublicBundle, createIdentity, ed25519ToX25519, verifyPreKeyBundle } from './index.js';

/** A prekey response exactly as registerPrekeyHandler builds it. */
async function response(identity: Awaited<ReturnType<typeof createIdentity>>) {
  const sodium = await getSodium();
  const bundle = await buildPublicBundle(identity);
  return {
    identityKey: Array.from(bundle.identityKey),
    signedPreKey: Array.from(bundle.signedPreKey),
    spkSig: Array.from(sodium.crypto_sign_detached(bundle.signedPreKey, identity.privateKey)),
    ed25519PubKey: Array.from(identity.publicKey),
    opkPublicKey: Array.from(new Uint8Array(32).fill(7)),
    opkId: 'opk-1',
  };
}

test('an honest prekey response is accepted as is', async () => {
  const bob = await createIdentity('bobpass');
  const json = await response(bob);
  const bundle = await verifyPreKeyBundle(json, bob.publicKeyHex);
  assert.deepEqual(Array.from(bundle.identityKey), json.identityKey);
  assert.deepEqual(Array.from(bundle.signedPreKey), json.signedPreKey);
  assert.equal(bundle.opkId, 'opk-1');
});

test('a prekey response whose unsigned X25519 identity key was swapped is refused', async () => {
  const bob = await createIdentity('bobpass');
  const mallory = await createIdentity('mallorypass');
  const json = await response(bob);
  // SPK and its signature stay valid; only the unsigned identityKey changes.
  json.identityKey = Array.from((await ed25519ToX25519(mallory.publicKey, mallory.privateKey)).publicKey);
  await assert.rejects(verifyPreKeyBundle(json, bob.publicKeyHex), /does not match its signing key/);
  json.identityKey = json.identityKey.slice(1);
  await assert.rejects(verifyPreKeyBundle(json, bob.publicKeyHex), /does not match its signing key/);
});

test('a prekey response from someone other than the expected contact is refused', async () => {
  const bob = await createIdentity('bobpass');
  const mallory = await createIdentity('mallorypass');
  await assert.rejects(verifyPreKeyBundle(await response(mallory), bob.publicKeyHex), /identity key mismatch/);
  const unsigned = { ...(await response(bob)), spkSig: [] };
  await assert.rejects(verifyPreKeyBundle(unsigned, bob.publicKeyHex), /missing SPK signature/);
});
