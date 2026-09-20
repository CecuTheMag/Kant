/**
 * A ratchet that does not survive a round-trip through storage is worse than
 * no persistence at all: it would load, fail to decrypt, and desync the
 * conversation silently. These tests pin the serialisation and the sealing.
 */
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sodiumLib from 'libsodium-wrappers';
const sodium: any = sodiumLib;

import { saveRatchet, loadRatchets, deleteRatchet } from './ratchetStore.js';
import { initSenderRatchet, ratchetEncrypt, ratchetDecrypt, initReceiverRatchet } from './ratchet.js';

const CONTACT = 'a'.repeat(64);

function freshKey(): Uint8Array {
  return sodium.randombytes_buf(32);
}

test('a stored ratchet round-trips byte-for-byte', async () => {
  await sodium.ready;
  const derivedKey = freshKey();
  const shared     = freshKey();
  const state      = await initSenderRatchet(shared, sodium.crypto_box_keypair().publicKey);

  await saveRatchet(CONTACT, derivedKey, state);
  const loaded = (await loadRatchets(derivedKey)).get(CONTACT);
  assert.ok(loaded, 'ratchet should be present after save');

  assert.deepEqual(loaded!.rootKey, state.rootKey);
  assert.deepEqual(loaded!.sendingChainKey, state.sendingChainKey);
  assert.deepEqual(loaded!.receivingChainKey, state.receivingChainKey);
  assert.deepEqual(loaded!.sendingRatchetKeyPair.publicKey, state.sendingRatchetKeyPair.publicKey);
  assert.deepEqual(loaded!.sendingRatchetKeyPair.privateKey, state.sendingRatchetKeyPair.privateKey);
  assert.deepEqual(loaded!.receivingRatchetPublic, state.receivingRatchetPublic);
  assert.equal(loaded!.sendingNumber, state.sendingNumber);
  assert.equal(loaded!.receivingNumber, state.receivingNumber);
  assert.deepEqual(loaded!.previousReceivingChainKey, state.previousReceivingChainKey);

  await deleteRatchet(CONTACT);
});

test('a restored ratchet can still decrypt the peer\'s next message', async () => {
  await sodium.ready;
  const derivedKey = freshKey();
  const shared     = freshKey();
  const receiverKeypair = sodium.crypto_box_keypair();

  const sender   = await initSenderRatchet(shared, receiverKeypair.publicKey);
  const receiver = await initReceiverRatchet(shared, receiverKeypair);

  // Advance both chains once so we are not testing the trivial initial state.
  const first = await ratchetEncrypt(sender, 'first');
  await ratchetDecrypt(receiver, first);

  // Persist the receiver mid-conversation, then reload it as a restart would.
  await saveRatchet(CONTACT, derivedKey, receiver);
  const restored = (await loadRatchets(derivedKey)).get(CONTACT);
  assert.ok(restored, 'receiver ratchet should reload');

  const second = await ratchetEncrypt(sender, 'second');
  const plain  = await ratchetDecrypt(restored!, second);
  assert.equal(plain, 'second', 'restored ratchet must decrypt the next message');

  await deleteRatchet(CONTACT);
});

test('a ratchet sealed under one identity key is not readable with another', async () => {
  await sodium.ready;
  const state = await initSenderRatchet(freshKey(), sodium.crypto_box_keypair().publicKey);

  await saveRatchet(CONTACT, freshKey(), state);
  const withWrongKey = await loadRatchets(freshKey());
  assert.equal(withWrongKey.size, 0, 'wrong key must yield nothing, not throw');

  await deleteRatchet(CONTACT);
});
