/**
 * A relay hosted behind a tunnel (Tailscale Funnel, Cloudflare Tunnel, ngrok),
 * end to end with nothing mocked: the relay's only way in is one port, its
 * HTTP API, reached through a TCP forwarder that stands in for the tunnel.
 * Its libp2p port listens on 127.0.0.1 and is never dialled by clients.
 *
 *     alice ─┐                         ┌─ bob
 *            └─ tunnel ─▶ relay A API ─┘
 *                            ║ federation, also through B's tunnel
 *     carol ──── tunnel ─▶ relay B API
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
  createNode, createIdentity, registerWithRelay, lookupPeers, sendPing, getRelayInfo, configureFederation,
} from './index.js';
import type { UnlockedIdentity } from './identity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY_ENTRY = join(HERE, '..', '..', 'relay', 'dist', 'index.js');
const TOKEN = 'single-port-test-token';

interface Relay {
  name: string; port: number; http: number; tunnelPort: number; peerId: string; dir: string;
  proc?: ChildProcess; tunnel?: net.Server; tunnelled: number; log: string[];
  /** The public URL: what the tunnel exposes and users paste into the app. */
  url: string;
}

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

async function makeRelay(name: string, port: number): Promise<Relay> {
  const dir = mkdtempSync(join(tmpdir(), `kant-single-${name}-`));
  const seed = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(join(dir, `relay-seed-${port}.bin`), seed, { mode: 0o600 });
  const peerId = peerIdFromPrivateKey(await generateKeyPairFromSeed('Ed25519', seed)).toString();
  const tunnelPort = port + 2;
  return { name, port, http: port + 1, tunnelPort, url: `http://127.0.0.1:${tunnelPort}`, peerId, dir, tunnelled: 0, log: [] };
}

/** The "tunnel": forwards raw bytes from a public port to the relay's API port, nothing else. */
function startTunnel(r: Relay): Promise<void> {
  r.tunnel = net.createServer((inbound) => {
    r.tunnelled++;
    const out = net.connect(r.http, '127.0.0.1');
    inbound.pipe(out).pipe(inbound);
    const close = () => { inbound.destroy(); out.destroy(); };
    inbound.on('error', close); out.on('error', close);
    inbound.on('close', close); out.on('close', close);
  });
  return new Promise((res) => r.tunnel!.listen(r.tunnelPort, '127.0.0.1', () => res()));
}

function startRelay(r: Relay, federateWith: Relay): void {
  r.proc = spawn(process.execPath, [RELAY_ENTRY], {
    env: {
      ...process.env,
      RELAY_PORT: String(r.port), RELAY_INFO_PORT: String(r.http),
      RELAY_PUBLIC_URL: r.url, RELAY_HTTP_BIND: '127.0.0.1', RELAY_WS_BIND: '127.0.0.1', RELAY_DATA_DIR: r.dir,
      RELAY_FEDERATION: `${federateWith.url}#${federateWith.peerId}`,
      RELAY_LAB_CONTROL_TOKEN: TOKEN,
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (b: Buffer) => { for (const line of b.toString().split('\n')) if (line) r.log.push(line); if (r.log.length > 4000) r.log.splice(0, 1000); };
  r.proc.stdout!.on('data', keep);
  r.proc.stderr!.on('data', keep);
}

async function stopRelay(r: Relay): Promise<void> {
  r.tunnel?.close();
  if (!r.proc || r.proc.exitCode !== null) return;
  const done = new Promise((res) => r.proc!.once('exit', res));
  r.proc.kill('SIGTERM');
  await Promise.race([done, sleep(3000)]);
  if (r.proc.exitCode === null) r.proc.kill('SIGKILL');
}

interface Client { node: Libp2p; inbox: Array<{ from: string; msg: string }>; circuit: string }

/** A client that only knows the relay's public (tunnel) URL, as a user who pasted it would. */
async function startClient(id: UnlockedIdentity, home: Relay): Promise<Client> {
  const info = await getRelayInfo(undefined, home.url);
  assert.ok(info, `relay ${home.name} answers through its tunnel`);
  const inbox: Client['inbox'] = [];
  const node = await createNode((from, msg) => { inbox.push({ from, msg }); }, undefined, info.multiaddr, id);
  configureFederation(node, info.multiaddr, (info as any).federation);
  const circuit = await waitFor('circuit reservation', () =>
    node.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit') && a.includes(home.peerId)), 60_000);
  await registerWithRelay(home.tunnelPort, id.publicKeyHex, circuit, node.peerId.toString(), id.privateKey, home.url);
  return { node, inbox, circuit };
}

function rawUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: a2FudGthbnRrYW50a2FudA==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    let buf = '';
    s.on('data', (d) => { buf += d.toString(); if (buf.includes('\r\n')) s.destroy(); });
    s.on('close', () => resolve(buf.split('\r\n')[0]));
    s.on('error', () => resolve(''));
    setTimeout(() => s.destroy(), 3000);
  });
}

describe('relay behind a tunnel: one port, nothing else reachable', { timeout: 300_000 }, () => {
  let A: Relay; let B: Relay;
  let alice: Client; let bob: Client; let carol: Client;
  let aliceId: UnlockedIdentity; let bobId: UnlockedIdentity; let carolId: UnlockedIdentity;

  before(async () => {
    A = await makeRelay('A', 39700);
    B = await makeRelay('B', 39710);
    await startTunnel(A);
    await startTunnel(B);
    startRelay(A, B);
    startRelay(B, A);
    try {
      await waitFor('relays federated through their tunnels', async () => {
        const [a, b] = await Promise.all([getRelayInfo(undefined, A.url), getRelayInfo(undefined, B.url)]) as any[];
        return a?.federation?.peers?.includes(B.peerId) && b?.federation?.peers?.includes(A.peerId);
      }, 60_000);
    } catch (e) {
      for (const r of [A, B]) console.error(`--- relay ${r.name} log ---\n${r.log.slice(-40).join('\n')}`);
      throw e;
    }
    aliceId = await createIdentity('alice-password');
    bobId = await createIdentity('bob-password');
    carolId = await createIdentity('carol-password');
    alice = await startClient(aliceId, A);
    bob = await startClient(bobId, A);
    carol = await startClient(carolId, B);
  });

  after(async () => {
    for (const c of [alice, bob, carol]) { try { await c?.node.stop(); } catch { /* */ } }
    for (const r of [A, B]) { if (r) { await stopRelay(r); rmSync(r.dir, { recursive: true, force: true }); } }
  });

  test('the relay announces its tunnel, for libp2p and federation alike', async () => {
    const info = await getRelayInfo(undefined, A.url) as any;
    assert.equal(info.multiaddr, `/ip4/127.0.0.1/tcp/${A.tunnelPort}/ws/p2p/${A.peerId}`);
    assert.equal(info.federation.tunnel, `/ip4/127.0.0.1/tcp/${A.tunnelPort}/ws`);
  });

  test('clients reach the relay through the tunnel only', async () => {
    for (const c of [alice, bob]) {
      const toRelay = c.node.getConnections().filter((conn) => conn.remotePeer.toString() === A.peerId);
      assert.ok(toRelay.length > 0);
      for (const conn of toRelay) assert.match(conn.remoteAddr.toString(), new RegExp(`/tcp/${A.tunnelPort}/`));
    }
    assert.ok(A.tunnelled > 0);
  });

  test('Alice → Bob on the same relay', async () => {
    await sendPing(alice.node, bob.circuit, 'hello through the tunnel');
    const got = await waitFor('Bob receives', () => bob.inbox.find((m) => m.msg === 'hello through the tunnel'));
    assert.equal(got.from, alice.node.peerId.toString());
  });

  test('Alice → Carol across federated relays, both behind tunnels', async () => {
    const found = await lookupPeers(A.tunnelPort, [carolId.publicKeyHex], A.url, aliceId);
    assert.equal(found[carolId.publicKeyHex], carol.circuit);
    await sendPing(alice.node, carol.circuit, 'hello across tunnels');
    const got = await waitFor('Carol receives', () => carol.inbox.find((m) => m.msg === 'hello across tunnels'));
    assert.equal(got.from, alice.node.peerId.toString());
  });

  test('Carol → Alice the other way round', async () => {
    const found = await lookupPeers(B.tunnelPort, [aliceId.publicKeyHex], B.url, carolId);
    await sendPing(carol.node, found[aliceId.publicKeyHex], 'hi back');
    await waitFor('Alice receives', () => alice.inbox.find((m) => m.msg === 'hi back'));
  });

  test('/metrics is hidden from the tunnel without the operator token', async () => {
    assert.equal((await fetch(`${A.url}/metrics`)).status, 404);
    assert.equal((await fetch(`${A.url}/metrics`, { headers: { Authorization: 'Bearer wrong' } })).status, 404);
    const ok = await fetch(`${A.url}/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /kant_relay_/);
  });

  test('only `/` is handed to libp2p; other upgrade paths are refused', async () => {
    assert.match(await rawUpgrade(A.tunnelPort, '/'), /101/);
    assert.match(await rawUpgrade(A.tunnelPort, '/somewhere-else'), /404/);
    assert.match(await rawUpgrade(A.tunnelPort, '/fed/not-a-peer'), /404/);
  });
});
