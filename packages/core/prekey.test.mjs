/**
 * Kant prekey + X3DH + ratchet integration test
 * Run: node prekey.test.mjs  (after pnpm build in packages/core)
 */

import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Resolve libsodium dynamically — no hardcoded paths
const sodium = require('libsodium-wrappers');
await sodium.ready;

// ── IndexedDB shim ────────────────────────────────────────────────────────────
// Supports get/put/delete/clear/getAll + deleteObjectStore for schema upgrades.

const dbStores = {};

function makeRequest(resultFn, errorFn) {
  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
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

function makeObjectStore(data) {
  return {
    get(key)         { return makeRequest(() => data[key]); },
    put(value, key)  { return makeRequest(() => { const k = key ?? value?.id ?? value?.publicKeyHex ?? value?.fileId; data[k] = value; }); },
    delete(key)      { return makeRequest(() => { delete data[key]; }); },
    clear()          { return makeRequest(() => { for (const k of Object.keys(data)) delete data[k]; }); },
    getAll()         { return makeRequest(() => Object.values(data)); },
  };
}

function makeTransaction(dbData, _mode) {
  return { objectStore: (s) => makeObjectStore(dbData[s] ?? (dbData[s] = {})) };
}

function makeDB(name, onupgradeneeded) {
  if (!dbStores[name]) dbStores[name] = {};
  const data = dbStores[name];
  const db = {
    _data: data,
    objectStoreNames: { contains: (s) => s in data },
    createObjectStore(s)  { if (!(s in data)) data[s] = {}; },
    deleteObjectStore(s)  { delete data[s]; },
    transaction: (s, m)   => makeTransaction(data, m),
    close() {},
  };
  onupgradeneeded?.({ target: { result: db } });
  return db;
}

globalThis.indexedDB = {
  open(name, _version) {
    const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    Promise.resolve().then(() => {
      req.result = makeDB(name, (e) => req.onupgradeneeded?.(e));
      req.onsuccess?.({ target: req });
    });
    return req;
  },
};

// ── Imports ───────────────────────────────────────────────────────────────────

import { buildPublicBundle, buildPrivateBundle, getOrCreateSPK } from './dist/prekey.js';
import {
  x3dhSend, x3dhReceive,
  initSenderRatchet, initReceiverRatchet,
  ratchetEncrypt, ratchetDecrypt,
  ed25519ToX25519,
} from './dist/ratchet.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

function bytesEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function makeIdentity() {
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyHex: sodium.to_hex(kp.publicKey) };
}

// ── Test 1: SPK persistence ───────────────────────────────────────────────────

console.log('\nTest 1: SPK persistence');
{
  const spk1 = await getOrCreateSPK();
  const spk2 = await getOrCreateSPK();
  assert(bytesEqual(spk1.publicKey, spk2.publicKey), 'same SPK returned on second call');
  assert(spk1.publicKey.length === 32, 'SPK public key is 32 bytes');
}

// ── Test 2: Bundle consistency ────────────────────────────────────────────────

console.log('\nTest 2: Bundle consistency');
{
  const bob = makeIdentity();
  const pub  = await buildPublicBundle(bob);
  const priv = await buildPrivateBundle(bob);
  assert(bytesEqual(pub.identityKey, priv.identityKeypair.publicKey), 'public IK matches private IK');
  assert(bytesEqual(pub.signedPreKey, priv.signedPreKeypair.publicKey), 'public SPK matches private SPK');
}

// ── Test 3: X3DH shared secret agreement ─────────────────────────────────────

console.log('\nTest 3: X3DH shared secret agreement');
{
  const alice = makeIdentity();
  const bob   = makeIdentity();

  const aliceX25519      = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle  = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  const { sharedSecret: ss1, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const ss2 = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);

  assert(bytesEqual(ss1, ss2), 'Alice and Bob derive identical shared secret');
  assert(ss1.length === 32, 'shared secret is 32 bytes');
}

// ── Test 4: Full ratchet round-trip ──────────────────────────────────────────

console.log('\nTest 4: Ratchet encrypt/decrypt (Alice → Bob)');
{
  const alice = makeIdentity();
  const bob   = makeIdentity();

  const aliceX25519      = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle  = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  const { sharedSecret, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const bobShared = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);

  const aliceState = await initSenderRatchet(sharedSecret, bobPublicBundle.signedPreKey);
  const bobState   = await initReceiverRatchet(bobShared, bobPrivateBundle.signedPreKeypair);

  const plain = 'hello from alice';
  const enc   = await ratchetEncrypt(aliceState, plain);
  const dec   = await ratchetDecrypt(bobState, enc);
  assert(dec === plain, `decrypted matches: "${dec}"`);
}

// ── Test 5: Bidirectional multi-message ratchet ───────────────────────────────

console.log('\nTest 5: Multi-message ratchet (bidirectional)');
{
  const alice = makeIdentity();
  const bob   = makeIdentity();

  const aliceX25519      = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle  = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  const { sharedSecret, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const bobShared = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);

  const aliceState = await initSenderRatchet(sharedSecret, bobPublicBundle.signedPreKey);
  const bobState   = await initReceiverRatchet(bobShared, bobPrivateBundle.signedPreKeypair);

  for (const m of ['msg1', 'msg2', 'msg3']) {
    const dec = await ratchetDecrypt(bobState, await ratchetEncrypt(aliceState, m));
    assert(dec === m, `Alice→Bob: "${m}"`);
  }

  const reply = 'reply from bob';
  const decReply = await ratchetDecrypt(aliceState, await ratchetEncrypt(bobState, reply));
  assert(decReply === reply, `Bob→Alice: "${reply}"`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
