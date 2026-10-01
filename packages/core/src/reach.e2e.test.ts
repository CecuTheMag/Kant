/**
 * Reaching a contact on a relay ours does NOT federate with, end to end, with
 * nothing mocked: two independent relay processes and real Kant nodes.
 *
 *     alice ──▶ relay A          relay B ◀── bob      (no federation)
 *
 * This is the "we each run our own relay, and the next day we couldn't talk"
 * case. It checks the properties the app's reconnect logic relies on:
 *  - Alice's relay can't find Bob, but Bob's relay answers an anonymous lookup;
 *  - the address it returns is Bob's, and a ping over it arrives from Bob's
 *    identity-derived PeerID (what the presence check in useKant binds to);
 *  - after Bob goes offline and comes back, the address Alice kept still works
 *    without any lookup — so a failed dial must never make her forget it.
 *
 * Run with `pnpm test:federation` (builds core, relay and this test).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { Libp2p } from 'libp2p';
import { createNode, createIdentity, registerWithRelay, lookupPeers, sendPing, getRelayInfo } from './index.js';
import { getSodium } from './sodium.js';
import { addrReaches, peerIdForIdentity } from './reach.js';
import type { UnlockedIdentity } from './identity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY_ENTRY = join(HERE, '..', '..', 'relay', 'dist', 'index.js');

interface RelayProc { name: string; port: number; http: number; peerId: string; dir: string; proc?: ChildProcess; log: string[] }
interface Client { node: Libp2p; inbox: Array<{ from: string; msg: string }>; circuit: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  let lastErr: unknown;
  for (;;) {
    try { const v = await fn(); if (v) return v as T; } catch (e) { lastErr = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${lastErr ? `: ${lastErr}` : ''}`);
    await sleep(300);
  }
}

async function startRelay(name: string, port: number): Promise<RelayProc> {
  const dir = mkdtempSync(join(tmpdir(), `kant-reach-${name}-`));
  const seed = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(join(dir, `relay-seed-${port}.bin`), seed, { mode: 0o600 });
  const r: RelayProc = { name, port, http: port + 1, dir, log: [],
    peerId: peerIdFromPrivateKey(await generateKeyPairFromSeed('Ed25519', seed)).toString() };
  r.proc = spawn(process.execPath, [RELAY_ENTRY], {
    env: {
      ...process.env,
      RELAY_PORT: String(r.port), RELAY_INFO_PORT: String(r.http),
      RELAY_PUBLIC_HOST: '127.0.0.1', RELAY_HTTP_BIND: '127.0.0.1', RELAY_DATA_DIR: r.dir,
      RELAY_FEDERATION: '', LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (b: Buffer) => { for (const line of b.toString().split('\n')) if (line) r.log.push(line); if (r.log.length > 4000) r.log.splice(0, 1000); };
  r.proc.stdout!.on('data', keep);
  r.proc.stderr!.on('data', keep);
  await waitFor(`relay ${name}`, () => getRelayInfo(undefined, url(r)), 60_000);
  return r;
}

async function stopRelay(r: RelayProc): Promise<void> {
  if (!r.proc || r.proc.exitCode !== null) return;
  const done = new Promise((res) => r.proc!.once('exit', res));
  r.proc.kill('SIGTERM');
  await Promise.race([done, sleep(3000)]);
  if (r.proc.exitCode === null) r.proc.kill('SIGKILL');
}

const url = (r: RelayProc) => `http://127.0.0.1:${r.http}`;

async function startClient(id: UnlockedIdentity, home: RelayProc): Promise<Client> {
  const info = await getRelayInfo(undefined, url(home));
  const inbox: Client['inbox'] = [];
  const node = await createNode((from, msg) => { inbox.push({ from, msg }); }, undefined, info!.multiaddr, id);
  const circuit = await waitFor('circuit reservation', () =>
    node.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit') && a.includes(home.peerId)), 60_000);
  await registerWithRelay(home.http, id.publicKeyHex, circuit, node.peerId.toString(), id.privateKey, url(home));
  return { node, inbox, circuit };
}

/** What lookupAtRelay sends, minus its URL policy (which refuses the loopback test relays). */
async function anonymousLookup(r: RelayProc, keys: string[]): Promise<Record<string, string>> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  return lookupPeers(r.http, keys, url(r), { publicKeyHex: sodium.to_hex(kp.publicKey), privateKey: kp.privateKey });
}

describe('reaching a contact on an unfederated relay (two real relays)', { timeout: 300_000 }, () => {
  let A: RelayProc; let B: RelayProc;
  let alice: Client; let bob: Client | undefined;
  let aliceId: UnlockedIdentity; let bobId: UnlockedIdentity;
  let storedAddr = '';

  before(async () => {
    try {
      A = await startRelay('A', 39500);
      B = await startRelay('B', 39510);
    } catch (e) {
      for (const r of [A, B]) if (r) console.error(`--- relay ${r.name} log ---\n${r.log.slice(-40).join('\n')}`);
      throw e;
    }
    aliceId = await createIdentity('alice-password');
    bobId = await createIdentity('bob-password');
    alice = await startClient(aliceId, A);
    bob = await startClient(bobId, B);
  });

  after(async () => {
    for (const c of [alice, bob]) { try { await c?.node.stop(); } catch { /* */ } }
    for (const r of [A, B]) { if (r) { await stopRelay(r); rmSync(r.dir, { recursive: true, force: true }); } }
  });

  test("Alice's relay can't find Bob; Bob's relay answers an anonymous lookup with Bob's address", async () => {
    const mine = await lookupPeers(A.http, [bobId.publicKeyHex], url(A), aliceId);
    assert.equal(mine[bobId.publicKeyHex], undefined);
    const theirs = await anonymousLookup(B, [bobId.publicKeyHex]);
    assert.equal(theirs[bobId.publicKeyHex], bob!.circuit);
    assert.ok(addrReaches(theirs[bobId.publicKeyHex], bobId.publicKeyHex));
    assert.ok(!addrReaches(theirs[bobId.publicKeyHex], aliceId.publicKeyHex));
    storedAddr = theirs[bobId.publicKeyHex];
  });

  test('a ping over that address arrives from the PeerID of the identity it claims', async () => {
    await sendPing(alice.node, storedAddr, JSON.stringify({ type: 'kant-presence', fromPubKeyHex: aliceId.publicKeyHex, circuitAddr: alice.circuit }));
    const got = await waitFor('ping at Bob', () => bob!.inbox.find((m) => m.msg.includes('kant-presence')));
    assert.equal(got.from, peerIdForIdentity(aliceId.publicKeyHex));
    assert.ok(addrReaches(JSON.parse(got.msg).circuitAddr, aliceId.publicKeyHex));
  });

  test('Bob offline: the dial fails, and nothing about the address was wrong', async () => {
    await bob!.node.stop();
    bob = undefined;
    await assert.rejects(sendPing(alice.node, storedAddr, JSON.stringify({ type: 'probe' })));
  });

  test('Bob back on the same relay: the address Alice kept reaches him again with no lookup', async () => {
    bob = await startClient(bobId, B);
    assert.equal(bob.circuit, storedAddr, 'identity-derived PeerID + stable relay identity = same address');
    await waitFor('delivery to the kept address', async () => {
      try { await sendPing(alice.node, storedAddr, JSON.stringify({ type: 'hello-again' })); } catch { return false; }
      return bob!.inbox.some((m) => m.msg.includes('hello-again'));
    }, 60_000);
  });

  test('Bob moves to Alice\'s relay: the old relay no longer knows him, the new one does', async () => {
    await bob!.node.stop();
    bob = await startClient(bobId, A);
    const found = await lookupPeers(A.http, [bobId.publicKeyHex], url(A), aliceId);
    assert.equal(found[bobId.publicKeyHex], bob.circuit);
    assert.ok(addrReaches(bob.circuit, bobId.publicKeyHex));
    assert.notEqual(bob.circuit, storedAddr);
  });
});
