/**
 * Relay federation, end to end, with nothing mocked: two real relay processes
 * federated with each other, and two real Kant nodes — one homed on each.
 *
 *     alice ──▶ relay A ══tunnel══▶ relay B ──circuit──▶ bob
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
import net from 'node:net';
import 'fake-indexeddb/auto';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { Libp2p } from 'libp2p';
import {
  createNode, createIdentity, registerWithRelay, lookupPeers, sendPing, getRelayInfo,
  configureFederation, federatedRelays, ed25519ToX25519,
} from './index.js';
import { registerFileHandler, sendFile } from './files.js';
import { createHash, randomBytes } from 'node:crypto';
import { multiaddr } from '@multiformats/multiaddr';
import type { UnlockedIdentity } from './identity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY_ENTRY = join(HERE, '..', '..', 'relay', 'dist', 'index.js');

interface RelayProc { name: string; port: number; http: number; peerId: string; dir: string; proc?: ChildProcess; log: string[] }

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

async function makeRelay(name: string, port: number): Promise<RelayProc> {
  const dir = mkdtempSync(join(tmpdir(), `kant-fed-${name}-`));
  const seed = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(join(dir, `relay-seed-${port}.bin`), seed, { mode: 0o600 });
  const peerId = peerIdFromPrivateKey(await generateKeyPairFromSeed('Ed25519', seed)).toString();
  return { name, port, http: port + 1, peerId, dir, log: [] };
}

function startRelay(r: RelayProc, federateWith: RelayProc): void {
  r.proc = spawn(process.execPath, [RELAY_ENTRY], {
    env: {
      ...process.env,
      RELAY_PORT: String(r.port), RELAY_INFO_PORT: String(r.http),
      RELAY_PUBLIC_HOST: '127.0.0.1', RELAY_HTTP_BIND: '127.0.0.1', RELAY_DATA_DIR: r.dir,
      RELAY_FEDERATION: `http://127.0.0.1:${federateWith.http}#${federateWith.peerId}`,
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (b: Buffer) => { for (const line of b.toString().split('\n')) if (line) r.log.push(line); if (r.log.length > 4000) r.log.splice(0, 1000); };
  r.proc.stdout!.on('data', keep);
  r.proc.stderr!.on('data', keep);
}

async function stopRelay(r: RelayProc): Promise<void> {
  if (!r.proc || r.proc.exitCode !== null) return;
  const done = new Promise((res) => r.proc!.once('exit', res));
  r.proc.kill('SIGTERM');
  await Promise.race([done, sleep(3000)]);
  if (r.proc.exitCode === null) r.proc.kill('SIGKILL');
}

async function relayInfo(r: RelayProc): Promise<any> {
  return getRelayInfo(undefined, `http://127.0.0.1:${r.http}`);
}

async function metric(r: RelayProc, name: string): Promise<number> {
  const text = await (await fetch(`http://127.0.0.1:${r.http}/metrics`)).text();
  let sum = 0;
  for (const line of text.split('\n')) if (line.startsWith(name) && !line.startsWith('#')) sum += Number(line.split(' ').pop());
  return sum;
}

interface Client { id: UnlockedIdentity; node: Libp2p; inbox: Array<{ from: string; msg: string }>; circuit: string; home: RelayProc }

async function startClient(id: UnlockedIdentity, home: RelayProc): Promise<Client> {
  const info = await relayInfo(home);
  const inbox: Client['inbox'] = [];
  const node = await createNode((from, msg) => { inbox.push({ from, msg }); }, undefined, info.multiaddr, id);
  configureFederation(node, info.multiaddr, info.federation);
  const circuit = await waitFor('circuit reservation', () =>
    node.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit') && a.includes(home.peerId)), 60_000);
  await registerWithRelay(home.http, id.publicKeyHex, circuit, node.peerId.toString(), id.privateKey, `http://127.0.0.1:${home.http}`);
  return { id, node, inbox, circuit, home };
}

describe('relay federation (two real relays, two real nodes)', { timeout: 300_000 }, () => {
  let A: RelayProc; let B: RelayProc;
  let alice: Client; let bob: Client;
  let aliceId: UnlockedIdentity; let bobId: UnlockedIdentity;

  before(async () => {
    A = await makeRelay('A', 39400);
    B = await makeRelay('B', 39410);
    startRelay(A, B);
    startRelay(B, A);
    try {
      await waitFor('relays federated', async () => {
        const [a, b] = await Promise.all([relayInfo(A), relayInfo(B)]);
        return a?.federation?.peers?.includes(B.peerId) && b?.federation?.peers?.includes(A.peerId);
      }, 60_000);
    } catch (e) {
      for (const r of [A, B]) console.error(`--- relay ${r.name} log ---\n${r.log.slice(-40).join('\n')}`);
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

  test('each relay advertises the other and its tunnel endpoint', async () => {
    const a = await relayInfo(A);
    assert.deepEqual(a.federation, { tunnel: `/ip4/127.0.0.1/tcp/${A.http}/ws`, peers: [B.peerId] });
    assert.deepEqual(federatedRelays(alice.node), [B.peerId]);
  });

  test('federated lookup: Alice finds Bob through her own relay', async () => {
    const found = await lookupPeers(A.http, [bobId.publicKeyHex], `http://127.0.0.1:${A.http}`, aliceId);
    assert.equal(found[bobId.publicKeyHex], bob.circuit);
    assert.ok(bob.circuit.includes(`/p2p/${B.peerId}/p2p-circuit/`));
  });

  test('a peer relay answers federated lookups locally only (no recursion)', async () => {
    const stranger = '00'.repeat(32);
    const found = await lookupPeers(A.http, [stranger], `http://127.0.0.1:${A.http}`, aliceId);
    assert.deepEqual(found, {});
  });

  test('Alice → Bob travels Alice → relay A → relay B → Bob, and never dials relay B directly', async () => {
    const tunnelsBefore = await metric(A, 'kant_federation_tunnels_total{result="opened"}');
    await sendPing(alice.node, bob.circuit, 'hello across relays');
    const got = await waitFor('Bob receives', () => bob.inbox.find((m) => m.msg === 'hello across relays'));
    assert.equal(got.from, alice.node.peerId.toString(), 'Noise authenticated Alice end to end');
    assert.ok((await metric(A, 'kant_federation_tunnels_total{result="opened"}')) > tunnelsBefore, 'relay A opened a tunnel');
    const toB = alice.node.getConnections().filter((c) => c.remotePeer.toString() === B.peerId);
    assert.ok(toB.length > 0);
    for (const c of toB) {
      assert.match(c.remoteAddr.toString(), /\/http-path\/fed%2F/, `connection to relay B goes through the tunnel: ${c.remoteAddr}`);
      assert.doesNotMatch(c.remoteAddr.toString(), new RegExp(`/tcp/${B.port}/`));
    }
    assert.ok((await metric(A, 'kant_federation_tunnel_bytes_total')) > 0, 'ciphertext flowed through relay A');
  });

  test('Bob → Alice works the other way round', async () => {
    const found = await lookupPeers(B.http, [aliceId.publicKeyHex], `http://127.0.0.1:${B.http}`, bobId);
    await sendPing(bob.node, found[aliceId.publicKeyHex], 'hi back');
    const got = await waitFor('Alice receives', () => alice.inbox.find((m) => m.msg === 'hi back'));
    assert.equal(got.from, bob.node.peerId.toString());
  });

  test('a 3 MB file (the path voice notes use) crosses both relays intact', async () => {
    const bobX = await ed25519ToX25519(bobId.publicKey, bobId.privateKey);
    let received: Uint8Array | undefined;
    let meta: any;
    await registerFileHandler(bob.node, {
      onMeta: async (m) => { meta = m; return 'accept'; },
      onChunk: async () => {},
      onProgress: () => {},
      onComplete: async (_id, verified, data) => { assert.equal(verified, true); received = data; },
      onError: () => {},
    }, { recipientX25519: bobX });
    const source = new Uint8Array(randomBytes(3 * 1024 * 1024 - 7));
    await sendFile(alice.node, {
      peerCircuitAddr: bob.circuit, fileData: source, fileName: 'voice-note.webm', mimeType: 'audio/webm',
      recipientX25519Pub: bobX.publicKey, voice: { durationMs: 4200, waveform: [1, 50, 100] },
    });
    await waitFor('file delivered', () => received, 60_000);
    assert.equal(createHash('sha256').update(received!).digest('hex'), createHash('sha256').update(source).digest('hex'));
    assert.deepEqual(meta.voice, { durationMs: 4200, waveform: [1, 50, 100] });
  });

  test('direct dials to a federated relay are refused while federation is on', async () => {
    // force: a fresh connection, so the gater is consulted instead of the tunnel being reused.
    await assert.rejects(alice.node.dial(multiaddr(`/ip4/127.0.0.1/tcp/${B.port}/ws/p2p/${B.peerId}`), { force: true } as any));
  });

  test('Bob logs off and back on — Alice reaches him again', async () => {
    await bob.node.stop();
    bob = await startClient(bobId, B);
    const found = await lookupPeers(A.http, [bobId.publicKeyHex], `http://127.0.0.1:${A.http}`, aliceId);
    await waitFor('delivery after Bob returns', async () => {
      try { await sendPing(alice.node, found[bobId.publicKeyHex], 'welcome back'); } catch { return false; }
      return bob.inbox.find((m) => m.msg === 'welcome back');
    }, 60_000);
  });

  test('relay B restarts — federation heals and delivery resumes', async () => {
    await stopRelay(B);
    // While B is down, sends fail cleanly (the app queues and retries) — they don't hang.
    await assert.rejects(sendPing(alice.node, bob.circuit, 'while B is down'));
    await waitFor('relay A notices B is down', async () => !(await relayInfo(A))?.federation?.peers?.includes(B.peerId), 45_000);
    startRelay(B, A);
    await waitFor('relay A sees B again', async () => (await relayInfo(A))?.federation?.peers?.includes(B.peerId), 60_000);
    // Bob's app reconnects to his relay (the app's heartbeat does this); refresh Alice's view.
    await bob.node.stop();
    bob = await startClient(bobId, B);
    const aInfo = await relayInfo(A);
    configureFederation(alice.node, aInfo.multiaddr, aInfo.federation);
    const found = await lookupPeers(A.http, [bobId.publicKeyHex], `http://127.0.0.1:${A.http}`, aliceId);
    await waitFor('delivery after relay restart', async () => {
      try { await sendPing(alice.node, found[bobId.publicKeyHex], 'after restart'); } catch { return false; }
      return bob.inbox.find((m) => m.msg === 'after restart');
    }, 60_000);
  });

  test('tunnel endpoint refuses anyone without a valid, fresh, bound token', async () => {
    const tryUpgrade = (path: string) => new Promise<string>((resolve) => {
      const s = net.connect(A.http, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: a2FudGthbnRrYW50a2FudA==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      let buf = '';
      s.on('data', (d) => { buf += d.toString(); });
      s.on('close', () => resolve(buf.split('\r\n')[0]));
      setTimeout(() => s.destroy(), 3000);
    });
    assert.match(await tryUpgrade(`/fed/${B.peerId}`), /403/, 'no token');
    assert.match(await tryUpgrade(`/fed/${B.peerId}?t=garbage`), /403/, 'garbage token');
    assert.match(await tryUpgrade(`/fed/12D3KooWGdMKkH6Q6sb2cnomxuYnsZTq3Sb8bmtZEBbdNNckWADp?t=x`), /404/, 'not a federation peer');
    assert.match(await tryUpgrade('/somewhere-else'), /404/, 'not the tunnel path');
    // A well-formed token from a key that isn't connected to relay A.
    const stranger = await generateKeyPairFromSeed('Ed25519', crypto.getRandomValues(new Uint8Array(32)));
    const claim = { p: peerIdFromPrivateKey(stranger).toString(), d: B.peerId, t: Date.now(), n: 'aa'.repeat(16) };
    const signed = new TextEncoder().encode(JSON.stringify(claim));
    const token = `${Buffer.from(signed).toString('base64url')}.${Buffer.from(await stranger.sign(signed)).toString('base64url')}`;
    assert.match(await tryUpgrade(`/fed/${B.peerId}?t=${token}`), /403/, 'valid signature but not a client of this relay');
    const stale = { ...claim, t: Date.now() - 5 * 60_000 };
    const staleBytes = new TextEncoder().encode(JSON.stringify(stale));
    const staleToken = `${Buffer.from(staleBytes).toString('base64url')}.${Buffer.from(await stranger.sign(staleBytes)).toString('base64url')}`;
    assert.match(await tryUpgrade(`/fed/${B.peerId}?t=${staleToken}`), /403/, 'expired token');
  });
});
