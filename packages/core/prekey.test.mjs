/**
 * Kant prekey + X3DH + ratchet integration test
 * Run: node --experimental-vm-modules prekey.test.mjs
 * (or: node prekey.test.mjs after `npm run build`)
 */

// ── Node 18 polyfills ───────────────────────────────────────────────────────
import { webcrypto } from 'crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ── IndexedDB shim ────────────────────────────────────────────────────────────
// prekey.ts uses indexedDB; we provide a minimal in-memory shim before importing.

const stores = {};

function makeRequest(result, error) {
  const req = { result, error, onsuccess: null, onerror: null };
  Promise.resolve().then(() => error ? req.onerror?.(error) : req.onsuccess?.());
  return req;
}

function makeDB(name, version, onupgradeneeded) {
  if (!stores[name]) stores[name] = {};
  const db = {
    _data: stores[name],
    objectStoreNames: { contains: (s) => s in stores[name] },
    createObjectStore(s) { stores[name][s] = {}; },
    transaction(storeName, _mode) {
      return {
        objectStore(s) {
          const data = stores[name][s];
          return {
            get(key) { return makeRequest(data[key]); },
            put(value, key) { data[key] = value; return makeRequest(undefined); },
            delete(key) { delete data[key]; return makeRequest(undefined); }
          };
        }
      };
    },
    close() {}
  };
  // trigger upgrade for new stores
  const fakeEvent = { target: { result: db } };
  onupgradeneeded?.(fakeEvent);
  return db;
}

globalThis.indexedDB = {
  open(name, version) {
    const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    Promise.resolve().then(() => {
      req.result = makeDB(name, version, (e) => req.onupgradeneeded?.(e));
      req.onsuccess?.();
    });
    return req;
  }
};

// ── Imports ───────────────────────────────────────────────────────────────────

import { buildPublicBundle, buildPrivateBundle, getOrCreateSPK } from './dist/prekey.js';
import { x3dhSend, x3dhReceive, initSenderRatchet, initReceiverRatchet, ratchetEncrypt, ratchetDecrypt, ed25519ToX25519 } from './dist/ratchet.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sodium = require('./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js');

await sodium.ready;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function equal(a, b) {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIdentity() {
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyHex: sodium.to_hex(kp.publicKey) };
}

// ── Test 1: SPK persistence ───────────────────────────────────────────────────

console.log('\nTest 1: SPK persistence');
{
  const spk1 = await getOrCreateSPK();
  const spk2 = await getOrCreateSPK();
  assert(equal(spk1.publicKey, spk2.publicKey), 'same SPK returned on second call');
  assert(spk1.publicKey.length === 32, 'SPK public key is 32 bytes');
}

// ── Test 2: buildPublicBundle / buildPrivateBundle consistency ────────────────

console.log('\nTest 2: Bundle consistency');
{
  const bob = makeIdentity();
  const pub = await buildPublicBundle(bob);
  const priv = await buildPrivateBundle(bob);

  assert(equal(pub.identityKey, priv.identityKeypair.publicKey), 'public IK matches private IK');
  assert(equal(pub.signedPreKey, priv.signedPreKeypair.publicKey), 'public SPK matches private SPK');
}

// ── Test 3: X3DH shared secret agreement ─────────────────────────────────────

console.log('\nTest 3: X3DH shared secret agreement');
{
  const alice = makeIdentity();
  const bob = makeIdentity();

  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  const { sharedSecret: ss1, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const ss2 = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);

  assert(equal(ss1, ss2), 'Alice and Bob derive identical shared secret');
  assert(ss1.length === 32, 'shared secret is 32 bytes');
}

// ── Test 4: Full ratchet round-trip (Alice → Bob) ─────────────────────────────

console.log('\nTest 4: Ratchet encrypt/decrypt (Alice → Bob)');
{
  const alice = makeIdentity();
  const bob = makeIdentity();

  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  const { sharedSecret, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const bobSharedSecret = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);

  const aliceState = await initSenderRatchet(sharedSecret, bobPublicBundle.signedPreKey);
  const bobState = await initReceiverRatchet(bobSharedSecret, bobPrivateBundle.signedPreKeypair);

  const plaintext = 'hello from alice';
  const encrypted = await ratchetEncrypt(aliceState, plaintext);
  const decrypted = await ratchetDecrypt(bobState, encrypted);

  assert(decrypted === plaintext, `decrypted matches: "${decrypted}"`);
}

// ── Test 5: Multi-message ratchet (both directions) ───────────────────────────

console.log('\nTest 5: Multi-message ratchet (bidirectional)');
{
  const alice = makeIdentity();
  const bob = makeIdentity();

  const aliceX25519 = await ed25519ToX25519(alice.publicKey, alice.privateKey);
  const bobPublicBundle = await buildPublicBundle(bob);
  const bobPrivateBundle = await buildPrivateBundle(bob);

  const { sharedSecret, ephemeralPublic } = await x3dhSend(aliceX25519, bobPublicBundle);
  const bobSharedSecret = await x3dhReceive(bobPrivateBundle, aliceX25519.publicKey, ephemeralPublic);

  const aliceState = await initSenderRatchet(sharedSecret, bobPublicBundle.signedPreKey);
  const bobState = await initReceiverRatchet(bobSharedSecret, bobPrivateBundle.signedPreKeypair);

  // Alice sends 3 messages
  const msgs = ['msg1', 'msg2', 'msg3'];
  for (const m of msgs) {
    const enc = await ratchetEncrypt(aliceState, m);
    const dec = await ratchetDecrypt(bobState, enc);
    assert(dec === m, `Alice→Bob: "${m}"`);
  }

  // Bob replies
  const reply = 'reply from bob';
  const encReply = await ratchetEncrypt(bobState, reply);
  const decReply = await ratchetDecrypt(aliceState, encReply);
  assert(decReply === reply, `Bob→Alice: "${reply}"`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
