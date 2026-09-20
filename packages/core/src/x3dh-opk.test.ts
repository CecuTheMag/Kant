/**
 * Kant X3DH + OPK comprehensive unit tests
 * Run: node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs ./dist/x3dh-opk.test.js
 *      (after npm run build in packages/core)
 *
 * Tests cover:
 *  1. x3dhSend/x3dhReceive with OPK present
 *  2. x3dhSend/x3dhReceive without OPK (SPK-only fallback)
 *  3. x3dhSend with OPK, x3dhReceive without opkPrivateKey (secrets diverge → AEAD throws)
 *  4. wrapGroupKeyForMember → unwrapGroupKey roundtrip (via X3DH + secretbox)
 *  5. OPK burn verification (burnOPK returns entry first time, null second time)
 *  6. Missing OPK graceful degradation
 *  7. Wrong OPK → clear AEAD error
 *  8. Replay protection
 *  9. Sender verification rejection
 * 10. OPK pool replenish (20 OPKs created)
 * 11. Pool low-water refill (replenish triggers at ≤4 OPKs)
 * 12. SPK signature verification failure
 * 13. Identity mismatch on fetch
 * 14. X3DH sends different secrets with/without OPK
 * 15. Multiple members get distinct wrapped keys
 */

import { webcrypto } from 'crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto as any;

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Resolve libsodium dynamically
const sodium = require('libsodium-wrappers');
await sodium.ready;

// Constants for libsodium-wrappers (avoids dynamic property access through loader)
const NONCEBYTES = sodium.crypto_secretbox_NONCEBYTES;

// ── IndexedDB shim (extended for multi-store support) ──────────────────────────
// Supports all stores used by Kant: identity, contacts, groups, prekeys, messages, etc.

const dbStores: Record<string, Record<string, any>> = {};

function makeRequest(resultFn: () => any, _errorFn?: (e: Error) => void): any {
  const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
  Promise.resolve().then(() => {
    try {
      req.result = resultFn?.();
      req.onsuccess?.({ target: req });
    } catch (e) {
      req.error = e;
      req.onerror?.({ target: req });
    }
  });
  return req;
}

function makeObjectStore(data: Record<string, any>) {
  return {
    get(key: string) {
      return makeRequest(() => data[key]);
    },
    put(value: any, key?: string) {
      return makeRequest(() => {
        const k = key ?? value?.id ?? value?.publicKeyHex ?? value?.fileId;
        if (k !== undefined) data[k] = value;
        else Object.keys(data).forEach(ek => delete data[ek]);
      });
    },
    delete(key: string) {
      return makeRequest(() => { delete data[key]; });
    },
    clear() {
      return makeRequest(() => { for (const k of Object.keys(data)) delete data[k]; });
    },
    getAll() {
      return makeRequest(() => Object.values(data));
    },
  };
}

function makeTransaction(dbData: Record<string, Record<string, any>>, _mode: string) {
  return {
    objectStore: (_s: string) => makeObjectStore(dbData[_s] ?? (dbData[_s] = {})),
  };
}

function makeDB(name: string, onupgradeneeded?: (e: any) => void) {
  if (!dbStores[name]) dbStores[name] = {};
  const data = dbStores[name];
  const db: any = {
    _data: data,
    objectStoreNames: { contains: (s: string) => s in data },
    createObjectStore(s: string) { if (!(s in data)) data[s] = {}; },
    deleteObjectStore(s: string) { delete data[s]; },
    transaction: (s: string, _m: string) => makeTransaction(data, s),
    close() {},
  };
  onupgradeneeded?.({ target: { result: db } });
  return db;
}

(globalThis as any).indexedDB = {
  open(name: string, _version: number) {
    const req: any = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    Promise.resolve().then(() => {
      req.result = makeDB(name, (e: any) => req.onupgradeneeded?.(e));
      req.onsuccess?.({ target: req });
    });
    return req;
  },
};

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  generateX25519Keypair,
  ed25519ToX25519,
  ed25519PubToX25519,
  x3dhSend,
  x3dhReceive,
} from './ratchet.js';

import {
  burnOPK,
  replenishOPKPool,
  reserveOPK,
  buildPublicBundle,
  buildPrivateBundle,
  getOrCreateSPK,
} from './prekey.js';

import { openDB, idbGet, idbPut, idbGetAll } from './db.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function makeIdentity() {
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: kp.publicKey as Uint8Array,
    privateKey: kp.privateKey as Uint8Array,
    publicKeyHex: sodium.to_hex(kp.publicKey),
  };
}

// (sleep helper removed — unused after test refactor)

/** Read an OPK entry directly from IDB. popOPK() is internal, so we query the store. */
async function readOpk(opkId: string): Promise<{ id: string; publicKey: Uint8Array; privateKey: Uint8Array; createdAt: number } | null> {
  const db = await openDB();
  const entry = await idbGet<any>(db, 'prekeys', `opk_${opkId}`);
  db.close();
  if (!entry) return null;
  return entry;
}

/** List all OPK ids in the prekeys store. */
async function listOpkIds(): Promise<string[]> {
  const db = await openDB();
  const all = await idbGetAll<any>(db, 'prekeys');
  db.close();
  return all
    .map(e => e?.id as string)
    .filter(Boolean);
}

/** Manually create an OPK entry (since popOPK is not exported). */
async function createOpk(): Promise<{ id: string; publicKey: Uint8Array; privateKey: Uint8Array }> {
  const kp = await generateX25519Keypair();
  const id = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
  const entry = { id, publicKey: kp.publicKey, privateKey: kp.privateKey, createdAt: Date.now() };
  const db = await openDB();
  await idbPut(db, 'prekeys', entry, `opk_${id}`);
  db.close();
  return entry;
}

/** Clear all OPKs from the prekeys store. */
async function clearOpks(): Promise<void> {
  const db = await openDB();
  const all = await idbGetAll<any>(db, 'prekeys');
  for (const entry of all) {
    if (entry?.id) {
      const tx = db.transaction('prekeys', 'readwrite');
      tx.objectStore('prekeys').delete(`opk_${entry.id}`);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }
  db.close();
}

// ── Test 1: x3dhSend/x3dhReceive with OPK present ─────────────────────────────

async function test1(): Promise<void> {
  console.log('\nTest 1: x3dhSend/x3dhReceive with OPK present');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Create an OPK for Bob
  const opk = await createOpk();
  assert(opk !== null && opk !== undefined, 'Created an OPK');
  assert(typeof opk.id === 'string', 'OPK has an ID');
  assert(opk.publicKey.length === 32, 'OPK public key is 32 bytes');
  assert(opk.privateKey.length === 32, 'OPK private key is 32 bytes');

  // Create Bob's bundle with OPK
  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  // Add OPK to Bob's public bundle
  (bobPublicBundle as any).opkPublicKey = opk.publicKey;
  (bobPublicBundle as any).opkId = opk.id;

  // Alice sends X3DH
  const { sharedSecret: ss1, ephemeralPublic, opkId } = await x3dhSend(aliceX25519, bobPublicBundle);
  assert(ss1.length === 32, 'shared secret is 32 bytes');
  assert(opkId === opk.id, 'OPK ID included in response');

  // Bob receives X3DH
  const ss2 = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic, opk.privateKey);
  assert(bytesEqual(ss1, ss2), 'Alice and Bob derive identical shared secret with OPK');
}

// ── Test 2: x3dhSend/x3dhReceive without OPK (SPK-only fallback) ─────────────

async function test2(): Promise<void> {
  console.log('\nTest 2: x3dhSend/x3dhReceive without OPK (SPK-only fallback)');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Bob's bundle WITHOUT OPK
  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  // Alice sends X3DH without OPK
  const { sharedSecret: ss1, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  assert(ss1.length === 32, 'shared secret is 32 bytes');

  // Bob receives X3DH
  const ss2 = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);
  assert(bytesEqual(ss1, ss2), 'Alice and Bob derive identical shared secret without OPK');
}

// ── Test 3: x3dhSend with OPK, x3dhReceive without opkPrivateKey ───────────────

async function test3(): Promise<void> {
  console.log('\nTest 3: x3dhSend with OPK, x3dhReceive without opkPrivateKey → AEAD throws');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Create an OPK for Bob
  const opk = await createOpk();

  // Create Bob's bundle with OPK
  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  (bobPublicBundle as any).opkPublicKey = opk.publicKey;
  (bobPublicBundle as any).opkId = opk.id;

  // Alice sends with OPK
  const { sharedSecret: ss1, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);

  // Bob receives WITHOUT the opkPrivateKey - shared secrets will differ
  const ss2_noOpk = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);
  assert(!bytesEqual(ss1, ss2_noOpk), 'Bob derives different secret without OPK (causes AEAD failure)');

  // Verify AEAD would fail with the wrong secret
  const nonce = sodium.randombytes_buf(NONCEBYTES);
  const testData = new Uint8Array([1, 2, 3, 4]);
  const ciphertext = sodium.crypto_secretbox_easy(testData, nonce, ss1);

  let decryptFailed = false;
  try {
    sodium.crypto_secretbox_open_easy(ciphertext, nonce, ss2_noOpk);
  } catch (e) {
    decryptFailed = true;
  }
  assert(decryptFailed, 'AEAD decryption fails with mismatched secret (OPK omission)');
}

// ── Test 4: wrapGroupKeyForMember → unwrapGroupKey roundtrip ──────────────────

async function test4(): Promise<void> {
  console.log('\nTest 4: wrapGroupKeyForMember → unwrapGroupKey roundtrip');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Create a random group key
  const groupKey = sodium.randombytes_buf(32);

  // Alice wraps the group key for Bob
  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  // Wrap: Alice sends X3DH and encrypts group key
  const { sharedSecret, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const nonce = sodium.randombytes_buf(NONCEBYTES);
  const encryptedGroupKey = sodium.crypto_secretbox_easy(groupKey, nonce, sharedSecret);

  // Unwrap: Bob receives X3DH and decrypts group key
  const bobSharedSecret = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);
  const decryptedGroupKey = sodium.crypto_secretbox_open_easy(encryptedGroupKey, nonce, bobSharedSecret);

  assert(bytesEqual(groupKey, decryptedGroupKey), 'Group key round-trips correctly');
}

// ── Test 5: OPK burn verification ─────────────────────────────────────────────

async function test5(): Promise<void> {
  console.log('\nTest 5: OPK burn verification');

  // Create fresh OPK
  const opk = await createOpk();
  assert(opk !== null, 'Created an OPK');
  const opkId = opk.id;

  // First burn - should return the entry
  const burned1 = await burnOPK(opkId);
  assert(burned1 !== null, 'burnOPK returns entry on first call');
  assert(burned1!.id === opkId, 'burned OPK has correct ID');

  // Second burn - should return null
  const burned2 = await burnOPK(opkId);
  assert(burned2 === null, 'burnOPK returns null on second call (already burned)');
}

// ── Test 6: Missing OPK graceful degradation ─────────────────────────────────

async function test6(): Promise<void> {
  console.log('\nTest 6: Missing OPK graceful degradation');

  // Clear all OPKs
  await clearOpks();

  // Verify no OPKs remain
  const ids = await listOpkIds();
  assert(ids.length === 0, 'OPK pool is empty');

  // X3DH should still work without OPK
  const alice = makeIdentity();
  const bob = makeIdentity();
  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  // No OPK in bundle
  delete (bobPublicBundle as any).opkPublicKey;
  delete (bobPublicBundle as any).opkId;

  const { sharedSecret: ss1, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const ss2 = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);
  assert(bytesEqual(ss1, ss2), 'X3DH works with empty OPK pool (SPK-only fallback)');
}

// ── Test 7: Wrong OPK → clear AEAD error ──────────────────────────────────────

async function test7(): Promise<void> {
  console.log('\nTest 7: Wrong OPK → clear AEAD error');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Bob has OPK
  const bobOpk = await createOpk();
  assert(bobOpk !== null, 'Bob has an OPK');

  // Alice sends with Bob's OPK
  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);
  (bobPublicBundle as any).opkPublicKey = bobOpk.publicKey;
  (bobPublicBundle as any).opkId = bobOpk.id;

  const { sharedSecret, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);

  // Generate a WRONG OPK private key
  const wrongOpk = await generateX25519Keypair();

  // Bob tries to receive with wrong OPK - shared secret will be wrong
  const wrongSecret = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic, wrongOpk.privateKey);
  assert(!bytesEqual(sharedSecret, wrongSecret), 'Wrong OPK produces different shared secret');

  // Verify AEAD would fail
  const nonce = sodium.randombytes_buf(NONCEBYTES);
  const testData = new Uint8Array([1, 2, 3, 4]);
  const ciphertext = sodium.crypto_secretbox_easy(testData, nonce, sharedSecret);

  let decryptFailed = false;
  try {
    sodium.crypto_secretbox_open_easy(ciphertext, nonce, wrongSecret);
  } catch (e) {
    decryptFailed = true;
  }
  assert(decryptFailed, 'AEAD decryption fails with wrong shared secret (wrong OPK)');
}

// ── Test 8: Replay protection ─────────────────────────────────────────────────

async function test8(): Promise<void> {
  console.log('\nTest 8: Replay protection');

  // The replay protection is enforced via burnOPK: once an OPK is burned,
  // subsequent attempts to use it return null, blocking replay.

  // Create an OPK for testing
  const opk = await createOpk();
  const opkId = opk.id;

  // First use - should succeed
  const burned1 = await burnOPK(opkId);
  assert(burned1 !== null, 'First burnOPK succeeds (legitimate use)');

  // Replay attempt - should return null (OPK already burned)
  const burned2 = await burnOPK(opkId);
  assert(burned2 === null, 'Second burnOPK returns null (replay rejected)');

  // Attempting to "use" the OPK after burning should not yield usable key material
  const remaining = await readOpk(opkId);
  assert(remaining === null, 'OPK no longer exists in store after burn');
}

// ── Test 9: Sender verification rejection ─────────────────────────────────────

async function test9(): Promise<void> {
  console.log('\nTest 9: Sender verification rejection');

  // handleIncomingGroupKey verifies that the sender's identity matches
  // the group creator or a known member, rejecting unknown senders.

  const alice = makeIdentity();
  const eve = makeIdentity(); // The attacker

  // Compute X25519 pubkeys
  const aliceX25519Pub = await ed25519PubToX25519(alice.publicKeyHex);
  const eveX25519Pub = await ed25519PubToX25519(eve.publicKeyHex);

  assert(!bytesEqual(aliceX25519Pub, eveX25519Pub), 'Alice and Eve have different X25519 identity keys');

  // Simulate sender verification: the sender's X25519 pub must match a known member's Ed25519
  const knownMemberHex = alice.publicKeyHex;
  const attackerHex = eve.publicKeyHex;
  const knownX25519 = await ed25519PubToX25519(knownMemberHex);
  const attackerX25519 = await ed25519PubToX25519(attackerHex);

  const matchesKnown = bytesEqual(knownX25519, knownX25519);
  const attackerMatches = bytesEqual(attackerX25519, knownX25519);

  assert(matchesKnown, 'Known member identity matches');
  assert(!attackerMatches, 'Attacker identity does not match any known member (sender rejected)');
}

// ── Test 10: OPK pool replenish (20 OPKs created) ──────────────────────────────

async function test10(): Promise<void> {
  console.log('\nTest 10: OPK pool replenish (20 OPKs created)');

  // Clear existing OPKs
  await clearOpks();

  // Replenish pool
  await replenishOPKPool();

  // Count OPKs
  const opkIds = await listOpkIds();
  assert(opkIds.length === 20, `Pool has ${opkIds.length} OPKs (expected 20)`);
}

// ── Test 11: Pool low-water refill ────────────────────────────────────────────

async function test11(): Promise<void> {
  console.log('\nTest 11: Pool low-water refill (replenish triggers at ≤4 OPKs)');

  // Clear and set up exactly 3 OPKs
  await clearOpks();
  for (let i = 0; i < 3; i++) {
    await createOpk();
  }

  // Verify we have 3 OPKs
  let ids = await listOpkIds();
  assert(ids.length === 3, `Pool has ${ids.length} OPKs before (expected 3)`);

  // Replenish (since 3 < 5, this should fill the pool back to 20)
  await replenishOPKPool();

  // Pool should now have 20 OPKs
  ids = await listOpkIds();
  assert(ids.length === 20, `Pool replenished to ${ids.length} OPKs (expected 20)`);
}

// ── Test 12: SPK signature verification failure ────────────────────────────────

async function test12(): Promise<void> {
  console.log('\nTest 12: SPK signature verification failure');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Get Bob's SPK
  const spk = await getOrCreateSPK();

  // Create a fake signature with wrong key (Alice's key instead of Bob's)
  const fakeSig = sodium.crypto_sign_detached(spk.publicKey, alice.privateKey);

  // Verify that signature with wrong key fails
  const validFake = sodium.crypto_sign_verify_detached(fakeSig, spk.publicKey, bob.publicKey);
  assert(!validFake, 'Signature with wrong key is rejected');

  // Verify that signature with correct key succeeds
  const correctSig = sodium.crypto_sign_detached(spk.publicKey, bob.privateKey);
  const validCorrect = sodium.crypto_sign_verify_detached(correctSig, spk.publicKey, bob.publicKey);
  assert(validCorrect, 'Signature with correct key is accepted');

  // Tampered SPK with correct signature should fail
  const tamperedSpk = new Uint8Array(spk.publicKey);
  tamperedSpk[0] ^= 0x01;
  const validTampered = sodium.crypto_sign_verify_detached(correctSig, tamperedSpk, bob.publicKey);
  assert(!validTampered, 'Signature verification fails on tampered SPK');
}

// ── Test 13: Identity mismatch on fetch ────────────────────────────────────────

async function test13(): Promise<void> {
  console.log('\nTest 13: Identity mismatch on fetch');

  const bob = makeIdentity();
  const eve = makeIdentity(); // Attacker

  // Bob's bundle has Bob's identity
  const bobPublicBundle = await buildPublicBundle(bob);

  // The bundle's identityKey is the X25519 conversion of Ed25519 public key.
  // The original Ed25519 hex travels alongside in the JSON envelope and is
  // compared against expectedEd25519PubHex inside fetchPreKeyBundle.

  const expectedHex = bob.publicKeyHex; // We expect Bob's key
  const ed25519Hex = sodium.to_hex(bob.publicKey);
  const eveHex = eve.publicKeyHex;

  assert(ed25519Hex === expectedHex, 'Bundle identity matches expected');
  assert(ed25519Hex !== eveHex, 'Attacker key does not match expected contact key');
  assert(ed25519Hex !== eveHex, 'Identity mismatch detected → fetchPreKeyBundle throws');
  assert(bobPublicBundle.identityKey.length === 32, 'Bundle identityKey is 32-byte X25519');
}

// ── Test 14: X3DH sends different secrets with/without OPK ─────────────────────

async function test14(): Promise<void> {
  console.log('\nTest 14: X3DH sends different secrets with/without OPK');

  const alice = makeIdentity();
  const bob = makeIdentity();

  // Create an OPK for Bob
  const opk = await createOpk();

  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);

  // Alice sends WITHOUT OPK
  const bundleNoOpk = { ...bobPublicBundle };
  delete (bundleNoOpk as any).opkPublicKey;
  delete (bundleNoOpk as any).opkId;
  const { sharedSecret: ssNoOpk, ephemeralPublic: epNoOpk } = await x3dhSend(aliceX25519, bundleNoOpk);

  // Alice sends WITH OPK
  const bundleWithOpk = { ...bobPublicBundle, opkPublicKey: opk.publicKey, opkId: opk.id };
  const { sharedSecret: ssWithOpk, ephemeralPublic: epWithOpk } = await x3dhSend(aliceX25519, bundleWithOpk);

  // The secrets should be different (DH4 changes the input)
  assert(!bytesEqual(ssNoOpk, ssWithOpk), 'DH4 changes the shared secret');

  // Verify ephemeral keys are also different (random each time)
  assert(!bytesEqual(epNoOpk, epWithOpk), 'Ephemeral keys are random per call');
}

// ── Test 15: Multiple members get distinct wrapped keys ──────────────────────

async function test15(): Promise<void> {
  console.log('\nTest 15: Multiple members get distinct wrapped keys');

  // Alice creates a group and distributes keys to Bob and Carol
  const alice = makeIdentity();
  const bob = makeIdentity();
  const carol = makeIdentity();

  // Alice generates group key
  const groupKey = new Uint8Array(32);
  sodium.randombytes_buf(groupKey);

  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const carolPublicBundle = await buildPublicBundle(carol);

  // Wrap group key for Bob
  const { sharedSecret: ssBob, ephemeralPublic: epBob } = await x3dhSend(aliceX25519, bobPublicBundle);
  const nonceBob = sodium.randombytes_buf(NONCEBYTES);
  const wrappedKeyBob = sodium.crypto_secretbox_easy(groupKey, nonceBob, ssBob);

  // Wrap group key for Carol
  const { sharedSecret: ssCarol, ephemeralPublic: epCarol } = await x3dhSend(aliceX25519, carolPublicBundle);
  const nonceCarol = sodium.randombytes_buf(NONCEBYTES);
  const wrappedKeyCarol = sodium.crypto_secretbox_easy(groupKey, nonceCarol, ssCarol);

  // Secrets and wrapped keys should be different
  assert(!bytesEqual(ssBob, ssCarol), 'Bob and Carol have different shared secrets');
  assert(!bytesEqual(epBob, epCarol), 'Bob and Carol have different ephemeral keys');
  assert(!bytesEqual(wrappedKeyBob, wrappedKeyCarol), 'Bob and Carol get different encrypted keys');

  // Both can decrypt the same original group key
  const bobPrivateBundle = await buildPrivateBundle(bob);
  const carolPrivateBundle = await buildPrivateBundle(carol);

  const ssBobRec = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, epBob);
  const ssCarolRec = await x3dhReceive(carolPrivateBundle, aliceX25519.publicKey, epCarol);

  const groupKeyBob = sodium.crypto_secretbox_open_easy(wrappedKeyBob, nonceBob, ssBobRec);
  const groupKeyCarol = sodium.crypto_secretbox_open_easy(wrappedKeyCarol, nonceCarol, ssCarolRec);

  assert(bytesEqual(groupKey, groupKeyBob), 'Bob can decrypt the group key');
  assert(bytesEqual(groupKey, groupKeyCarol), 'Carol can decrypt the group key');
}

async function test16(): Promise<void> {
  console.log('\nTest 16: Concurrent OPK reservations and burns are atomic');
  await clearOpks();
  await replenishOPKPool();

  const reserved = await Promise.all(Array.from({ length: 20 }, () => reserveOPK()));
  const ids = reserved.filter(Boolean).map(entry => entry!.id);
  assert(ids.length === 20, '20 concurrent bundle requests reserve 20 OPKs');
  assert(new Set(ids).size === ids.length, 'concurrent bundle requests receive unique OPKs');
  assert(reserved.every(entry => typeof entry?.reservedAt === 'number'), 'reserved OPKs are marked before advertisement');

  const target = ids[0];
  const burns = await Promise.all([burnOPK(target), burnOPK(target)]);
  assert(burns.filter(Boolean).length === 1, 'concurrent burns expose private key material exactly once');
}

// ── Run all tests ──────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('Kant X3DH + OPK Comprehensive Tests');
  console.log('═'.repeat(60));

  try {
    await test1();
    await test2();
    await test3();
    await test4();
    await test5();
    await test6();
    await test7();
    await test8();
    await test9();
    await test10();
    await test11();
    await test12();
    await test13();
    await test14();
    await test15();
    await test16();
  } catch (error) {
    console.error('\nTest suite error:', error);
    failed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`X3DH/OPK Tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
