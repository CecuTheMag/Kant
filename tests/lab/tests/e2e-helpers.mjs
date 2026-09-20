import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import {
  createNode,
  getRelayInfo,
  sendPing,
  generateX25519Keypair,
  x3dhSend,
  x3dhReceive,
  initSenderRatchet,
  initReceiverRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
} from '../../../packages/core/dist/index.js';

export const relayInfoUrl = process.env.KANT_RELAY_INFO_URL ?? 'http://127.0.0.1:3001/relay-info';
export const relayBaseUrl = relayInfoUrl.replace(/\/relay-info$/, '');

export async function eventually(check, { timeout = 45_000, interval = 250, message = 'condition timed out' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { last = error; }
    await delay(interval);
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`);
}

export function wire(id, encrypted) {
  return JSON.stringify({
    id,
    header: { dhPublic: Array.from(encrypted.header.dhPublic), msgNum: encrypted.header.msgNum, prevChainLen: encrypted.header.prevChainLen },
    ciphertext: Array.from(encrypted.ciphertext),
    nonce: Array.from(encrypted.nonce),
  });
}

export function parseWire(raw) {
  const value = JSON.parse(raw);
  return {
    id: value.id,
    encrypted: {
      header: { dhPublic: new Uint8Array(value.header.dhPublic), msgNum: value.header.msgNum, prevChainLen: value.header.prevChainLen },
      ephemeralPublicKey: new Uint8Array(value.header.dhPublic),
      ciphertext: new Uint8Array(value.ciphertext),
      nonce: new Uint8Array(value.nonce),
    },
  };
}

export async function createPair() {
  const info = await eventually(() => getRelayInfo(undefined, relayBaseUrl), { message: 'relay info unavailable' });
  assert.ok(info?.multiaddr, 'relay did not advertise a multiaddr');
  const inboxA = [];
  const inboxB = [];
  const startAlice = () => createNode((_peer, raw) => inboxA.push(raw), undefined, info.multiaddr);
  const startBob = () => createNode((_peer, raw) => inboxB.push(raw), undefined, info.multiaddr);
  let alice = await startAlice();
  let bob = await startBob();
  const circuit = node => node.getMultiaddrs().map(String).find(addr => addr.includes('/p2p-circuit'));

  // A relay can accept the WebSocket dial while dropping the initial reservation
  // request. Match the production recovery: stop fully, then make one clean
  // reservation attempt. Keeping the old node alive causes a duplicate-peer race.
  if (!await eventually(() => circuit(alice) && circuit(bob), { timeout: 15_000, message: 'initial reservations absent' }).catch(() => false)) {
    await Promise.allSettled([alice.stop(), bob.stop()]);
    await delay(800);
    alice = await startAlice();
    bob = await startBob();
  }
  const bobAddr = await eventually(() => circuit(bob), { message: 'Bob reservation unavailable after recovery' });
  const aliceAddr = await eventually(() => circuit(alice), { message: 'Alice reservation unavailable after recovery' });

  const aliceIdentity = await generateX25519Keypair();
  const bobIdentity = await generateX25519Keypair();
  const bobSpk = await generateX25519Keypair();
  const aliceSent = await x3dhSend(aliceIdentity, { identityKey: bobIdentity.publicKey, signedPreKey: bobSpk.publicKey });
  const bobSecret = await x3dhReceive({ identityKeypair: bobIdentity, signedPreKeypair: bobSpk }, aliceIdentity.publicKey, aliceSent.ephemeralPublic);
  assert.deepEqual([...aliceSent.sharedSecret], [...bobSecret], 'X3DH peers derived different secrets');

  return {
    alice, bob, aliceAddr, bobAddr, inboxA, inboxB,
    aliceRatchet: await initSenderRatchet(aliceSent.sharedSecret, bobSpk.publicKey),
    bobRatchet: await initReceiverRatchet(bobSecret, bobSpk),
    async close() { await Promise.allSettled([alice.stop(), bob.stop()]); },
  };
}

export async function sendEncrypted(sender, destination, ratchet, id, plaintext) {
  const encrypted = await ratchetEncrypt(ratchet, plaintext);
  await sendPing(sender, destination, wire(id, encrypted));
}

export async function decryptInbox(inbox, ratchet, expectedCount) {
  await eventually(() => inbox.length >= expectedCount, { message: `expected ${expectedCount} inbound messages` });
  const received = [];
  while (inbox.length) {
    const { id, encrypted } = parseWire(inbox.shift());
    received.push({ id, plaintext: await ratchetDecrypt(ratchet, encrypted) });
  }
  return received;
}
