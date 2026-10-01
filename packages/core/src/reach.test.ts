import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { getSodium } from './sodium.js';
import { DB_NAME } from './db.js';
import { addContact, dropForeignContactAddr, getContact, setContactRelay, updateContactAddr } from './contacts.js';
import { addrReaches, contactRelayUrl, peerIdForIdentity } from './reach.js';
import { lookupAtRelay } from './index.js';

const RELAY = '12D3KooWRBy97UB99e3J6hiPesre1MZeuNQvfan4gBziswrRJsNK';

async function identity(): Promise<{ hex: string; peerId: string }> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  // Exactly how createNode derives the node key from the identity.
  const peerId = peerIdFromPrivateKey(await generateKeyPairFromSeed('Ed25519', kp.privateKey.slice(0, 32))).toString();
  return { hex: sodium.to_hex(kp.publicKey), peerId };
}

const circuit = (peerId: string, relay = RELAY) => `/dns4/relay.example/tcp/443/tls/ws/p2p/${relay}/p2p-circuit/p2p/${peerId}`;

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('deletion blocked'));
  });
}

describe('peerIdForIdentity', () => {
  test('matches the PeerID createNode runs under', async () => {
    const a = await identity();
    assert.equal(peerIdForIdentity(a.hex), a.peerId);
    assert.equal(peerIdForIdentity(a.hex.toUpperCase()), a.peerId);
  });

  test('is empty for malformed keys', () => {
    assert.equal(peerIdForIdentity('zz'), '');
    assert.equal(peerIdForIdentity('a'.repeat(63)), '');
  });
});

describe('addrReaches', () => {
  test('accepts only circuits that end at the contact', async () => {
    const a = await identity();
    const b = await identity();
    assert.equal(addrReaches(circuit(a.peerId), a.hex), true);
    assert.equal(addrReaches(circuit(b.peerId), a.hex), false, 'someone else');
    assert.equal(addrReaches(`/dns4/relay.example/tcp/443/tls/ws/p2p/${a.peerId}`, a.hex), false, 'not a circuit');
    assert.equal(addrReaches(`${circuit(a.peerId)}/p2p/${b.peerId}`, a.hex), false, 'trailing hop');
    assert.equal(addrReaches(circuit(a.peerId, 'not-a-peer'), a.hex), false, 'bad relay id');
    assert.equal(addrReaches('', a.hex), false);
    assert.equal(addrReaches(undefined, a.hex), false);
    assert.equal(addrReaches(`/dns4/${'x'.repeat(1100)}${circuit(a.peerId)}`, a.hex), false, 'overlong');
  });
});

describe('contactRelayUrl', () => {
  test('canonicalises http(s) URLs', () => {
    assert.equal(contactRelayUrl('https://relay.example.com/'), 'https://relay.example.com');
    assert.equal(contactRelayUrl('http://192.168.1.20:3001'), 'http://192.168.1.20:3001');
    assert.equal(contactRelayUrl('https://example.com/kant/'), 'https://example.com/kant');
  });

  test('refuses anything we should not contact', () => {
    for (const bad of ['ftp://relay.example', 'javascript:alert(1)', 'https://u:p@relay.example', 'https://relay.example/?x=1',
      'https://relay.example/#x', 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001', 'http://a.localhost',
      'not a url', '', 42, `https://${'a'.repeat(300)}.example`]) {
      assert.equal(contactRelayUrl(bad), undefined, String(bad));
    }
  });
});

describe('contact addresses', () => {
  afterEach(deleteDatabase);

  test('a failed or foreign address never replaces the last good one', async () => {
    const a = await identity();
    const b = await identity();
    await addContact(a.hex, 'Ana');
    assert.equal(await updateContactAddr(a.hex, circuit(a.peerId)), true);
    assert.equal(await updateContactAddr(a.hex, ''), false);
    assert.equal(await updateContactAddr(a.hex, circuit(b.peerId)), false);
    assert.equal((await getContact(a.hex))?.lastCircuitAddr, circuit(a.peerId));
  });

  test('addContact keeps the invite relay and ignores a foreign circuit', async () => {
    const a = await identity();
    const b = await identity();
    await addContact(a.hex, 'Ana', circuit(b.peerId), { relayUrl: 'https://relay.example/' });
    const stored = await getContact(a.hex);
    assert.equal(stored?.lastCircuitAddr, undefined);
    assert.equal(stored?.relayUrl, 'https://relay.example');
    // Renaming later does not drop the relay.
    await addContact(a.hex, 'Ana B');
    assert.equal((await getContact(a.hex))?.relayUrl, 'https://relay.example');
  });

  test('setContactRelay records a change once and refuses loopback', async () => {
    const a = await identity();
    await addContact(a.hex);
    assert.equal(await setContactRelay(a.hex, 'https://one.example'), true);
    assert.equal(await setContactRelay(a.hex, 'https://one.example/'), false);
    assert.equal(await setContactRelay(a.hex, 'http://127.0.0.1:3001'), false);
    assert.equal(await setContactRelay(a.hex, 'https://two.example'), true);
    assert.equal((await getContact(a.hex))?.relayUrl, 'https://two.example');
  });

  test('dropForeignContactAddr only clears an address that names someone else', async () => {
    const a = await identity();
    const b = await identity();
    await addContact(a.hex);
    await updateContactAddr(a.hex, circuit(a.peerId));
    assert.equal(await dropForeignContactAddr(a.hex), false);
    assert.equal((await getContact(a.hex))?.lastCircuitAddr, circuit(a.peerId));

    // A record written by an old build that stored any address it was given.
    const { openDB, idbPut } = await import('./db.js');
    const db = await openDB();
    await idbPut(db, 'contacts', { ...(await getContact(a.hex)), lastCircuitAddr: circuit(b.peerId) });
    db.close();
    assert.equal(await dropForeignContactAddr(a.hex), true);
    assert.equal((await getContact(a.hex))?.lastCircuitAddr, undefined);
  });
});

describe('lookupAtRelay', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('signs with a throwaway key and returns only addresses that reach each contact', async () => {
    const a = await identity();
    const b = await identity();
    const c = await identity();
    const sodium = await getSodium();
    let request: any;
    let url = '';
    globalThis.fetch = (async (input: any, init: any) => {
      url = String(input);
      request = JSON.parse(init.body);
      return new Response(JSON.stringify({
        [a.hex]: circuit(a.peerId),      // genuine
        [b.hex]: circuit(c.peerId),      // points at someone else
        [c.hex]: circuit(c.peerId),      // not asked for
      }), { status: 200 });
    }) as typeof fetch;

    const found = await lookupAtRelay('https://their.example/', [a.hex, b.hex]);
    assert.deepEqual(found, { [a.hex]: circuit(a.peerId) });
    assert.equal(url, 'https://their.example/lookup');
    assert.deepEqual(request.keys, [a.hex, b.hex]);
    assert.ok(![a.hex, b.hex, c.hex].includes(request.publicKeyHex), 'must not reveal a real identity');
    const signed = new TextEncoder().encode(`${request.timestamp}|${request.nonce}|${request.keys.join(',')}`);
    assert.ok(sodium.crypto_sign_verify_detached(new Uint8Array(request.sig), signed, sodium.from_hex(request.publicKeyHex)));
  });

  test('never contacts a relay URL it refuses', async () => {
    const a = await identity();
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    assert.deepEqual(await lookupAtRelay('http://127.0.0.1:3001', [a.hex]), {});
    assert.equal(called, false);
  });
});
