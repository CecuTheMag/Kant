import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdentity,
  x3dhSend, x3dhReceive, ed25519ToX25519, x3dhInitMatchesIdentity,
  buildPublicBundle, buildPrivateBundle,
} from './index.js';

test('an x3dh-init claiming a contact must carry that contact\'s identity key', async () => {
  const alice = await createIdentity('alicepass');
  const mallory = await createIdentity('mallorypass');
  const bob = await createIdentity('bobpass');
  const bobBundle = await buildPublicBundle(bob);
  const bobPrivate = await buildPrivateBundle(bob);

  // Honest init: Alice's X25519 key is the one derived from her identity.
  const aliceX = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  assert.equal(await x3dhInitMatchesIdentity(alice.publicKeyHex, aliceX.publicKey), true);

  // Forged init: Mallory names Alice as the sender but uses her own key. From
  // Bob's public bundle alone she gets the same secret Bob would derive, so
  // without the check her session would be filed under Alice.
  const malloryX = await ed25519ToX25519(mallory.publicKey, mallory.privateKey);
  const forged = await x3dhSend(malloryX, bobBundle);
  const bobSide = await x3dhReceive(bobPrivate, malloryX.publicKey, forged.ephemeralPublic);
  assert.deepEqual(bobSide, forged.sharedSecret);
  assert.equal(await x3dhInitMatchesIdentity(alice.publicKeyHex, malloryX.publicKey), false);
});

test('malformed claimed identities are refused', async () => {
  const alice = await createIdentity('alicepass');
  const aliceX = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  for (const claimed of [undefined, '', 'zz', alice.publicKeyHex.slice(2), 42, 'ff'.repeat(32)]) {
    assert.equal(await x3dhInitMatchesIdentity(claimed, aliceX.publicKey), false, String(claimed));
  }
  assert.equal(await x3dhInitMatchesIdentity(alice.publicKeyHex, aliceX.publicKey.slice(1)), false);
  // Upper-case hex names the same identity.
  assert.equal(await x3dhInitMatchesIdentity(alice.publicKeyHex.toUpperCase(), aliceX.publicKey), true);
});
