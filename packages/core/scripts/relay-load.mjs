/**
 * Transport-level relay load test: N real libp2p clients (the same createNode
 * the app uses) take circuit reservations on one relay, register, look each
 * other up and exchange messages through the relay.
 *
 * Unlike tests/lab/scripts/load-test.sh (registry only), every client here
 * holds a live WebSocket + Noise + yamux connection and a reservation, so this
 * measures what a relay can actually carry.
 *
 * Build core first (`pnpm run build`), then from packages/core:
 *   node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs scripts/relay-load.mjs \
 *     --relay http://127.0.0.1:3001 --clients 100 --procs 5 --rate 20 --fanout 3 --msgs 2
 *
 *   --relay   relay HTTP base URL (the one that serves /relay-info)
 *   --clients total clients          --procs  worker processes to spread them over
 *   --rate    client connects per second across all workers (ramp)
 *   --fanout  peers each client messages   --msgs  messages per peer
 *   --hold    seconds to keep everyone connected after delivery (soak)
 *   --json    write the summary as JSON to this path
 *
 * Exits non-zero unless every client reserved and every message arrived.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

if (process.env.KANT_LOAD_WORKER) await worker();
else await main();

async function main() {
  const relay = arg('relay', 'http://127.0.0.1:3001').replace(/\/$/, '');
  const clients = Number(arg('clients', 20));
  const procs = Math.min(clients, Number(arg('procs', Math.ceil(clients / 40))));
  const rate = Number(arg('rate', 10));
  const fanout = Math.min(clients - 1, Number(arg('fanout', 3)));
  const msgs = Number(arg('msgs', 2));
  const hold = Number(arg('hold', 0));
  const jsonOut = arg('json');

  const info = await (await fetch(`${relay}/relay-info`)).json();
  console.log(`relay ${info.peerId} at ${info.multiaddr}`);
  console.log(`${clients} clients over ${procs} processes, ramp ${rate}/s, ${fanout} peers × ${msgs} msgs each`);

  const workers = [];
  const ready = [];
  const failed = [];
  const received = [];
  const sendResults = [];
  const dropped = [];
  const t0 = Date.now();
  let startedCount = 0;

  for (let w = 0; w < procs; w++) {
    const count = Math.floor(clients / procs) + (w < clients % procs ? 1 : 0);
    const child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), {
      env: { ...process.env, KANT_LOAD_WORKER: '1' },
      execArgv: process.execArgv,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr.on('data', () => {});
    child.on('message', (m) => {
      if (m.ev === 'ready') ready.push(m);
      else if (m.ev === 'failed') failed.push(m);
      else if (m.ev === 'recv') received.push(...m.items);
      else if (m.ev === 'sent') sendResults.push(...m.items);
      else if (m.ev === 'dropped') dropped.push(...m.items);
      else if (m.ev === 'started') startedCount++;
    });
    workers.push({ child, count });
  }
  // Global ramp: worker w starts its k-th client at (k*procs + w) / rate seconds.
  workers.forEach((w, i) => w.child.send({ cmd: 'start', relay, info, count: w.count, offsetMs: (i * 1000) / rate, stepMs: (procs * 1000) / rate }));

  const reserveDeadline = Date.now() + (clients / rate) * 1000 + 120_000;
  while (ready.length + failed.length < clients && Date.now() < reserveDeadline) await sleep(500);
  const connectWall = (Date.now() - t0) / 1000;
  console.log(`reserved ${ready.length}/${clients} in ${connectWall.toFixed(1)}s (${failed.length} failed)`);
  const failReasons = {};
  for (const f of failed) failReasons[f.error] = (failReasons[f.error] ?? 0) + 1;
  if (failed.length) console.log('failure reasons:', failReasons);

  // Registry check: every ready client must resolve through /lookup.
  // Each client sends to `fanout` random ready peers.
  const peers = ready.map((r) => ({ pub: r.pub, circuit: r.circuit }));
  const plan = new Map(); // pub -> [targetPub]
  for (const r of ready) {
    const others = peers.filter((p) => p.pub !== r.pub);
    const picks = [];
    while (picks.length < Math.min(fanout, others.length)) {
      const p = others[Math.floor(Math.random() * others.length)];
      if (!picks.includes(p.pub)) picks.push(p.pub);
    }
    plan.set(r.pub, picks);
  }
  const expected = [...plan.values()].reduce((n, t) => n + t.length * msgs, 0);
  const tSend = Date.now();
  for (const w of workers) w.child.send({ cmd: 'send', plan: Object.fromEntries(plan), msgs });
  const deliverDeadline = Date.now() + 120_000;
  while ((received.length < expected || sendResults.length < expected) && Date.now() < deliverDeadline) await sleep(500);
  const deliverWall = (Date.now() - tSend) / 1000;

  if (hold > 0) {
    console.log(`holding ${hold}s…`);
    await sleep(hold * 1000);
  }

  const sendFail = sendResults.filter((s) => !s.ok);
  const lookupMiss = sendResults.filter((s) => s.lookupMiss).length;
  const sendReasons = {};
  for (const s of sendFail) sendReasons[s.error] = (sendReasons[s.error] ?? 0) + 1;
  // A "mutual" failure: the target was dialling the sender at the same time.
  const mutualFails = sendFail.filter((s) => s.to && plan.get(s.to)?.includes(s.from)).length;
  let mutualPairs = 0;
  for (const [a, ts] of plan) for (const b of ts) if (plan.get(b)?.includes(a)) mutualPairs++;
  const lat = received.map((r) => r.latency);
  const reserveMs = ready.map((r) => r.reserveMs);
  const summary = {
    relay, clients, procs, rate, fanout, msgs,
    reserved: ready.length, reserveFailed: failed.length, failReasons,
    reserveMs: { p50: pct(reserveMs, 50), p95: pct(reserveMs, 95), max: pct(reserveMs, 100) },
    connectWallS: +connectWall.toFixed(1),
    messages: { expected, sentOk: sendResults.length - sendFail.length, sendFailed: sendFail.length, sendReasons, mutualFails, mutualPairs: mutualPairs / 2, received: received.length, lookupMiss },
    latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: pct(lat, 100) },
    deliverWallS: +deliverWall.toFixed(1),
    droppedDuringRun: dropped.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(summary, null, 2));

  for (const w of workers) w.child.send({ cmd: 'stop' });
  await sleep(3000);
  for (const w of workers) w.child.kill('SIGKILL');
  const ok = ready.length === clients && received.length === expected && sendFail.length === 0;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

async function worker() {
  await import('fake-indexeddb/auto');
  // createNode logs every frame; keep the worker quiet.
  console.log = () => {};
  console.warn = () => {};
  const core = await import('../dist/index.js');
  const { default: sodium } = await import('libsodium-wrappers-sumo');
  await sodium.ready;

  const clients = new Map(); // pub -> { node, id, circuit }
  let relayUrl;
  const recvBuf = [];
  const flush = setInterval(() => {
    if (recvBuf.length) process.send({ ev: 'recv', items: recvBuf.splice(0) });
  }, 250);

  async function startOne(info) {
    const kp = sodium.crypto_sign_keypair();
    const id = { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyHex: sodium.to_hex(kp.publicKey) };
    const t = Date.now();
    let node;
    try {
      node = await core.createNode((from, msg) => {
        try {
          const m = JSON.parse(msg);
          if (m.type === 'load') recvBuf.push({ id: m.id, latency: Date.now() - m.t });
        } catch { /* ignore */ }
      }, undefined, info.multiaddr, id);
      let circuit;
      const end = Date.now() + 90_000;
      while (!circuit && Date.now() < end) {
        circuit = node.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit') && a.includes(info.peerId));
        if (!circuit) await sleep(250);
      }
      if (!circuit) throw new Error('no reservation within 90s');
      await core.registerWithRelay(0, id.publicKeyHex, circuit, node.peerId.toString(), id.privateKey, relayUrl);
      clients.set(id.publicKeyHex, { node, id, circuit });
      node.addEventListener('peer:disconnect', (e) => {
        if (e.detail?.toString() === info.peerId) process.send({ ev: 'dropped', items: [{ pub: id.publicKeyHex.slice(0, 12) }] });
      });
      process.send({ ev: 'ready', pub: id.publicKeyHex, circuit, reserveMs: Date.now() - t });
    } catch (e) {
      try { await node?.stop(); } catch { /* */ }
      process.send({ ev: 'failed', error: String(e?.message ?? e).slice(0, 80) });
    }
  }

  process.on('message', async (m) => {
    if (m.cmd === 'start') {
      relayUrl = m.relay;
      await sleep(m.offsetMs);
      const pending = [];
      for (let k = 0; k < m.count; k++) {
        pending.push(startOne(m.info));
        await sleep(m.stepMs);
      }
      await Promise.all(pending);
    } else if (m.cmd === 'send') {
      const jobs = [];
      for (const [pub, c] of clients) {
        const targets = m.plan[pub] ?? [];
        if (!targets.length) continue;
        jobs.push((async () => {
          const found = await core.lookupPeers(0, targets, relayUrl, c.id).catch(() => ({}));
          const out = [];
          for (const target of targets) {
            const addr = found[target];
            for (let i = 0; i < m.msgs; i++) {
              const msgId = `${pub.slice(0, 8)}-${target.slice(0, 8)}-${i}`;
              if (!addr) { out.push({ ok: false, lookupMiss: true, error: 'lookup miss' }); continue; }
              try {
                await core.sendPing(c.node, addr, JSON.stringify({ type: 'load', id: msgId, t: Date.now() }));
                out.push({ ok: true });
              } catch (e) {
                out.push({ ok: false, from: pub, to: target, error: String(e?.message ?? e).slice(0, 80) });
              }
            }
          }
          process.send({ ev: 'sent', items: out });
        })());
      }
      await Promise.all(jobs);
    } else if (m.cmd === 'stop') {
      clearInterval(flush);
      await Promise.all([...clients.values()].map((c) => c.node.stop().catch(() => {})));
      process.exit(0);
    }
  });
}
