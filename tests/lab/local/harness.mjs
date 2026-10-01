/**
 * Local harness for the device on/off reconnect tests: real relay processes,
 * the built web app, and one persistent browser profile per "device", so
 * closing a device and opening it again keeps its identity, contacts and
 * sessions exactly like a phone that was switched off.
 *
 * Relays are reached as relay-a.test, relay-b.test, … (mapped to 127.0.0.1 in
 * Chromium) because the app deliberately ignores loopback relay URLs that come
 * from contacts — a real deployment never has those.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RELAY_ENTRY = join(ROOT, 'packages', 'relay', 'dist', 'index.js');
const RESOLVE_TEST_HOSTS = join(dirname(fileURLToPath(import.meta.url)), 'resolve-test-hosts.mjs');
// KANT_APP_DIST: run the same scenarios against another build (e.g. an older release).
const APP_DIST = process.env.KANT_APP_DIST ?? join(ROOT, 'packages', 'app', 'dist');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** First of the ports this run uses (relays at +0/+10/+20, app at +90). KANT_PORT_BASE moves them all. */
export const PORT_BASE = Number(process.env.KANT_PORT_BASE ?? 39600);

/** Fail loudly on a busy port — otherwise a second run would quietly talk to the first run's relays. */
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer().once('error', () => reject(new Error(
      `port ${port} is already in use — is another reconnect test running? Stop it, or set KANT_PORT_BASE to another range.`)));
    probe.listen(port, '0.0.0.0', () => probe.close(resolve));
  });
}

export const WORK = mkdtempSync(join(tmpdir(), 'kant-reconnect-'));
export function cleanup() { rmSync(WORK, { recursive: true, force: true }); }

/* ── Relays ──────────────────────────────────────────────────────── */

/** A relay with a fixed seed and data dir, so stopping and starting it again is a restart, not a new relay. */
export function defineRelay(name, wsPort) {
  const dir = join(WORK, `relay-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `relay-seed-${wsPort}.bin`), randomBytes(32), { mode: 0o600 });
  return { name, host: `relay-${name}.test`, wsPort, httpPort: wsPort + 1, dir, proc: null, log: [], peers: [], peerId: '',
    get url() { return `http://${this.host}:${this.httpPort}`; } };
}

/** Federate every pair of `relays` (RELAY_FEDERATION on each). Takes effect on their next start. */
export async function federate(relays) {
  for (const r of relays) {
    if (!r.peerId) { await startRelay(r); await stopRelay(r); }
  }
  for (const r of relays) r.peers = relays.filter((p) => p !== r);
}

export async function startRelay(r) {
  if (r.proc && r.proc.exitCode === null) return;
  await assertPortFree(r.wsPort);
  await assertPortFree(r.httpPort);
  r.proc = spawn(process.execPath, ['--import', RESOLVE_TEST_HOSTS, RELAY_ENTRY], {
    env: {
      ...process.env,
      RELAY_PORT: String(r.wsPort), RELAY_INFO_PORT: String(r.httpPort),
      RELAY_PUBLIC_HOST: r.host, RELAY_HTTP_BIND: '127.0.0.1', RELAY_DATA_DIR: r.dir,
      // Relay-to-relay calls run in Node, which can't resolve the .test names.
      RELAY_FEDERATION: r.peers.map((p) => `http://127.0.0.1:${p.httpPort}#${p.peerId}`).join(','),
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (b) => { for (const line of b.toString().split('\n')) if (line) r.log.push(line); if (r.log.length > 2000) r.log.splice(0, 500); };
  r.proc.stdout.on('data', keep);
  r.proc.stderr.on('data', keep);
  const end = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${r.httpPort}/relay-info`);
      if (res.ok) {
        const info = await res.json();
        r.peerId = info.peerId;
        return;
      }
    } catch { /* starting */ }
    if (r.proc.exitCode !== null || Date.now() > end) throw new Error(`relay ${r.name} did not start:\n${r.log.slice(-30).join('\n')}`);
    await sleep(200);
  }
}

/** Wait until every federated relay in `relays` lists all its peers as reachable. */
export async function waitFederated(relays, ms = 60_000) {
  const end = Date.now() + ms;
  for (const r of relays) {
    for (;;) {
      try {
        const info = await (await fetch(`http://127.0.0.1:${r.httpPort}/relay-info`)).json();
        if (r.peers.every((p) => info.federation?.peers?.includes(p.peerId))) break;
      } catch { /* restarting */ }
      if (Date.now() > end) throw new Error(`relay ${r.name} never saw its federation peers:\n${r.log.slice(-20).join('\n')}`);
      await sleep(250);
    }
  }
}

export async function stopRelay(r) {
  if (!r.proc || r.proc.exitCode !== null) return;
  const done = new Promise((res) => r.proc.once('exit', res));
  r.proc.kill('SIGTERM');
  await Promise.race([done, sleep(3000)]);
  if (r.proc.exitCode === null) r.proc.kill('SIGKILL');
}

/* ── Web app ─────────────────────────────────────────────────────── */

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export async function serveApp(port) {
  if (!existsSync(join(APP_DIST, 'index.html'))) throw new Error('packages/app/dist missing — run `pnpm run build` first');
  await assertPortFree(port);
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(APP_DIST, path);
    if (!file.startsWith(APP_DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(APP_DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((res) => server.close(res)) };
}

/* ── Devices ─────────────────────────────────────────────────────── */

/**
 * A "device": a persistent Chromium profile. on() opens it (first time:
 * onboarding on `relay`; later: unlock), off() closes the browser outright.
 */
export function defineDevice(name, relays) {
  const profile = join(WORK, `device-${name}`);
  mkdirSync(profile, { recursive: true });
  const rules = relays.map((r) => `MAP ${r.host} 127.0.0.1`).join(', ');
  const device = {
    name, context: null, page: null, created: false, log: [],
    async on(appUrl, relay) {
      device.context = await chromium.launchPersistentContext(profile, {
        headless: process.env.HEADED !== '1',
        args: [`--host-resolver-rules=${rules}`],
        viewport: { width: 1200, height: 860 },
        serviceWorkers: 'block',
      });
      device.page = device.context.pages()[0] ?? await device.context.newPage();
      device.page.on('console', (m) => {
        device.log.push(`${new Date().toISOString().slice(11, 23)} ${m.text()}`);
        if (device.log.length > 4000) device.log.splice(0, 1000);
      });
      const since = device.log.length;
      await device.page.goto(appUrl);
      if (!device.created) {
        await onboard(device.page, name, relay);
        device.created = true;
      } else {
        await unlock(device.page);
      }
      await waitOnline(device, since);
    },
    async off() {
      if (!device.context) return;
      await device.context.close().catch(() => {});
      device.context = null;
      device.page = null;
    },
  };
  return device;
}

export const PASSWORD = 'Reconnect-Test-2026!';

async function onboard(page, name, relay) {
  await page.getByRole('button', { name: 'Agree and continue' }).click();
  await page.getByPlaceholder('relay.example.com').fill(relay.url);
  await page.getByPlaceholder('relay.example.com').press('Enter');
  await page.getByPlaceholder('How friends will see you').fill(name, { timeout: 60_000 });
  await page.getByPlaceholder('At least 8 characters').fill(PASSWORD);
  await page.getByPlaceholder('Type it again').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
}

async function unlock(page) {
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}

/** Wait until the device holds a circuit reservation on its relay (the app logs it once it has one). */
async function waitOnline(device, since, ms = 90_000) {
  const end = Date.now() + ms;
  while (!device.log.slice(since).some((l) => l.includes('Circuit from event') || l.includes('circuit=yes'))) {
    if (Date.now() > end) throw new Error(`${device.name} never got a relay circuit:\n${device.log.slice(-30).join('\n')}`);
    await sleep(250);
  }
}
