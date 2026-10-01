import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mayWriteRegistryKey } from './registry.js';

const ALICE = 'aa'.repeat(32);
const ALICE_EPHEMERAL = 'ae'.repeat(32);
const MALLORY = 'bb'.repeat(32);
const alicePeer = { peerId: '12D3KooWAlice' };

test('a device always owns the key it signed with', () => {
  assert.equal(mayWriteRegistryKey(undefined, ALICE, ALICE, alicePeer.peerId), true);
  // Even over an entry someone else planted under that key earlier.
  assert.equal(mayWriteRegistryKey({ peerId: '12D3KooWMallory' }, ALICE, ALICE.toUpperCase(), alicePeer.peerId), true);
});

test('an unsigned ephemeral key may refresh its own entry or take a free one', () => {
  assert.equal(mayWriteRegistryKey(undefined, ALICE_EPHEMERAL, ALICE, alicePeer.peerId), true);
  assert.equal(mayWriteRegistryKey(alicePeer, ALICE_EPHEMERAL, ALICE, alicePeer.peerId), true);
});

test('a client cannot list someone else\'s registered key as its ephemeral key', () => {
  // Mallory signs with her own identity but names Alice's identity or ephemeral key.
  assert.equal(mayWriteRegistryKey(alicePeer, ALICE, MALLORY, '12D3KooWMallory'), false);
  assert.equal(mayWriteRegistryKey(alicePeer, ALICE_EPHEMERAL, MALLORY, '12D3KooWMallory'), false);
});
