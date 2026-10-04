/**
 * One client holding relayed connections to many peers at once, end to end
 * against a real relay process.
 *
 *     hub ──▶ relay ◀── peer 1 … peer N
 *
 * Every relayed connection keeps one circuit-relay HOP stream open on the
 * client's connection to its relay for as long as it lives. libp2p caps
 * streams per protocol per connection (32 inbound at the relay, 64 outbound at
 * the client), so before the fix a group owner or anyone with more than 32
 * contacts online could never reach the 33rd: the dial came back "The stream
 * has been reset" over and over. N is above both caps.
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
import type { Libp2p } from 'libp2p';
import { createNode, sendPing, getRelayInfo } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELAY_ENTRY = join(HERE, '..', '..', 'relay', 'dist', 'index.js');
const N = Number(process.env.KANT_FANOUT_PEERS ?? 70);
const PORT = 39530;

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

interface Peer { node: Libp2p; inbox: string[]; circuit: string }

describe(`one client reaching ${N} peers through one relay at the same time`, { timeout: 300_000 }, () => {
  let relay: ChildProcess;
  let dir: string;
  const log: string[] = [];
  let hub: Peer;
  const peers: Peer[] = [];

  async function startPeer(relayAddr: string): Promise<Peer> {
    const inbox: string[] = [];
    const node = await createNode((_from, msg) => { inbox.push(msg); }, undefined, relayAddr);
    const circuit = await waitFor('circuit reservation', () =>
      node.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit')), 60_000);
    return { node, inbox, circuit };
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kant-fanout-'));
    writeFileSync(join(dir, `relay-seed-${PORT}.bin`), crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
    relay = spawn(process.execPath, [RELAY_ENTRY], {
      env: {
        ...process.env,
        RELAY_PORT: String(PORT), RELAY_INFO_PORT: String(PORT + 1),
        RELAY_PUBLIC_HOST: '127.0.0.1', RELAY_HTTP_BIND: '127.0.0.1', RELAY_DATA_DIR: dir,
        RELAY_FEDERATION: '', LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (b: Buffer) => { for (const line of b.toString().split('\n')) if (line) log.push(line); if (log.length > 2000) log.splice(0, 500); };
    relay.stdout!.on('data', keep);
    relay.stderr!.on('data', keep);
    const info = await waitFor('relay', async () => (await getRelayInfo(undefined, `http://127.0.0.1:${PORT + 1}`)) ?? undefined, 60_000);
    hub = await startPeer(info.multiaddr);
    for (let i = 0; i < N; i += 10) {
      peers.push(...await Promise.all(Array.from({ length: Math.min(10, N - i) }, () => startPeer(info.multiaddr))));
    }
  });

  after(async () => {
    await Promise.allSettled([hub, ...peers].filter(Boolean).map((p) => p.node.stop()));
    if (relay && relay.exitCode === null) {
      const done = new Promise((res) => relay.once('exit', res));
      relay.kill('SIGTERM');
      await Promise.race([done, sleep(3000)]);
      if (relay.exitCode === null) relay.kill('SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test(`the hub reaches all ${N} peers at once, and every connection stays open`, async () => {
    const results = await Promise.allSettled(peers.map((p, i) => sendPing(hub.node, p.circuit, `fan-out ${i}`)));
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [`peer ${i}: ${(r.reason as Error)?.message ?? r.reason}`] : []);
    assert.deepEqual(failed, [], `dials failed:\n${failed.slice(0, 5).join('\n')}\n--- relay log ---\n${log.slice(-20).join('\n')}`);
    await waitFor('every ping delivered', () => peers.every((p, i) => p.inbox.includes(`fan-out ${i}`)), 60_000);
    // The point is simultaneous connections, not a sequence of short ones.
    const open = new Set(hub.node.getConnections().map((c) => c.remotePeer.toString()));
    const reachable = peers.filter((p) => open.has(p.node.peerId.toString())).length;
    assert.equal(reachable, N, `hub holds ${reachable}/${N} peer connections open`);
  });

  test(`all ${N} peers reach the hub at once`, async () => {
    const results = await Promise.allSettled(peers.map((p, i) => sendPing(p.node, hub.circuit, `fan-in ${i}`)));
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [`peer ${i}: ${(r.reason as Error)?.message ?? r.reason}`] : []);
    assert.deepEqual(failed, [], `dials failed:\n${failed.slice(0, 5).join('\n')}`);
    await waitFor('every ping delivered', () => peers.every((_, i) => hub.inbox.includes(`fan-in ${i}`)), 60_000);
  });
});
