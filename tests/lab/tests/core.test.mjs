import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateX25519Keypair,
  x3dhSend,
  x3dhReceive,
  initSenderRatchet,
  initReceiverRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
} from '../../../packages/core/dist/ratchet.js';
import { generateFileKey, encryptChunk, decryptChunk } from '../../../packages/core/dist/files.js';
import { parseQR } from '../../../packages/core/dist/contacts.js';

test('X3DH derives the same shared secret', async () => {
  const alice = await generateX25519Keypair();
  const bob = { identityKeypair: await generateX25519Keypair(), signedPreKeypair: await generateX25519Keypair() };
  const sent = await x3dhSend(alice, {
    identityKey: bob.identityKeypair.publicKey,
    signedPreKey: bob.signedPreKeypair.publicKey,
  });
  const received = await x3dhReceive(bob, alice.publicKey, sent.ephemeralPublic);
  assert.deepEqual([...sent.sharedSecret], [...received]);
});

test('ratchet encrypt/decrypt advances and rejects tampering', async () => {
  const alice = await generateX25519Keypair();
  const bob = { identityKeypair: await generateX25519Keypair(), signedPreKeypair: await generateX25519Keypair() };
  const sent = await x3dhSend(alice, { identityKey: bob.identityKeypair.publicKey, signedPreKey: bob.signedPreKeypair.publicKey });
  const shared = await x3dhReceive(bob, alice.publicKey, sent.ephemeralPublic);
  const aState = await initSenderRatchet(sent.sharedSecret, bob.signedPreKeypair.publicKey);
  const bState = await initReceiverRatchet(shared, bob.signedPreKeypair);
  const first = await ratchetEncrypt(aState, 'first message');
  assert.equal(await ratchetDecrypt(bState, first), 'first message');
  const reply = await ratchetEncrypt(bState, 'reply message');
  assert.equal(await ratchetDecrypt(aState, reply), 'reply message');
  const tampered = { ...first, ciphertext: new Uint8Array(first.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  await assert.rejects(() => ratchetDecrypt(bState, tampered));
});

test('file chunks authenticate index and decrypt exactly', async () => {
  const { key, nonce } = await generateFileKey();
  const plain = new TextEncoder().encode('attachment payload — unicode ✓');
  const encrypted = await encryptChunk(plain, key, nonce, 3);
  const decrypted = await decryptChunk(encrypted, key, nonce, 3);
  assert.deepEqual([...decrypted], [...plain]);
  await assert.rejects(() => decryptChunk(encrypted, key, nonce, 4));
});

test('QR parser accepts valid identity data and rejects malformed data', () => {
  const key = 'a'.repeat(64);
  assert.deepEqual(parseQR(`${key}|Alice`), { publicKeyHex: key, nickname: 'Alice' });
  assert.equal(parseQR('not-a-key'), null);
});

test('X3DH with OPK derives different secret than without OPK', async () => {
  const alice = await generateX25519Keypair();
  const bobIdentity = await generateX25519Keypair();
  const bobSPK = await generateX25519Keypair();
  const bobOPK = await generateX25519Keypair();

  // With OPK
  const sentWithOPK = await x3dhSend(alice, {
    identityKey: bobIdentity.publicKey,
    signedPreKey: bobSPK.publicKey,
    opkPublicKey: bobOPK.publicKey,
    opkId: 'test-opk-id',
  });
  const receivedWithOPK = await x3dhReceive(
    { identityKeypair: bobIdentity, signedPreKeypair: bobSPK },
    alice.publicKey,
    sentWithOPK.ephemeralPublic,
    bobOPK.privateKey
  );
  assert.deepEqual([...sentWithOPK.sharedSecret], [...receivedWithOPK], 'OPK shared secrets must match');
  assert.equal(sentWithOPK.opkId, 'test-opk-id', 'opkId must be returned from x3dhSend');

  // Without OPK — secret must differ
  const sentNoOPK = await x3dhSend(alice, {
    identityKey: bobIdentity.publicKey,
    signedPreKey: bobSPK.publicKey,
  });
  assert.notDeepEqual(
    [...sentWithOPK.sharedSecret],
    [...sentNoOPK.sharedSecret],
    'OPK and non-OPK secrets must differ'
  );
});

test('X3DH OPK: second receive with same OPK private key produces same secret (burn is caller responsibility)', async () => {
  // This test verifies the crypto is correct — the burn-on-use enforcement
  // is in prekey.ts (burnOPK) and tested via the IDB layer in integration tests.
  const alice = await generateX25519Keypair();
  const bobIdentity = await generateX25519Keypair();
  const bobSPK = await generateX25519Keypair();
  const bobOPK = await generateX25519Keypair();

  const sent = await x3dhSend(alice, {
    identityKey: bobIdentity.publicKey,
    signedPreKey: bobSPK.publicKey,
    opkPublicKey: bobOPK.publicKey,
    opkId: 'opk-burn-test',
  });

  const received1 = await x3dhReceive(
    { identityKeypair: bobIdentity, signedPreKeypair: bobSPK },
    alice.publicKey,
    sent.ephemeralPublic,
    bobOPK.privateKey
  );
  const received2 = await x3dhReceive(
    { identityKeypair: bobIdentity, signedPreKeypair: bobSPK },
    alice.publicKey,
    sent.ephemeralPublic,
    bobOPK.privateKey
  );
  // Both calls succeed with the same key — the IDB burn prevents reuse at the
  // protocol level; the crypto primitive itself is deterministic.
  assert.deepEqual([...received1], [...received2], 'same OPK key always derives same secret');
  assert.deepEqual([...sent.sharedSecret], [...received1], 'sender and receiver agree');
});
