/**
 * Smoke-test a packaged desktop build: launch it with a throwaway profile,
 * wait for the bundled private relay to report healthy, and check that the
 * renderer actually rendered the app (not a blank window or an error page).
 *
 *   node scripts/smoke.mjs <path to Kant executable, AppImage, or Kant.app/Contents/MacOS/Kant>
 *
 * Exits non-zero on any failure. Used by the release workflow on Linux,
 * Windows and macOS, and for checking local release builds before they are published.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const exe = process.argv[2];
if (!exe) {
  console.error('usage: node scripts/smoke.mjs <executable>');
  process.exit(2);
}

const DEBUG_PORT = Number(process.env.KANT_SMOKE_DEBUG_PORT ?? 9333);
const RELAY_INFO = 'http://127.0.0.1:3001';
const TIMEOUT_MS = 90_000;

// A fresh profile so the smoke test never touches (or is affected by) a real
// Kant install on the same machine. Electron derives userData from these.
const profile = mkdtempSync(join(tmpdir(), 'kant-smoke-'));
const env = {
  ...process.env,
  XDG_CONFIG_HOME: profile,
  APPDATA: profile,
  // Read by the app itself (main.ts); the only override that works on macOS.
  KANT_USER_DATA_DIR: join(profile, 'kant'),
  // AppImages need FUSE; CI runners often lack it, so extract-and-run instead,
  // into the throwaway folder so the copy is removed with it.
  APPIMAGE_EXTRACT_AND_RUN: '1',
  TMPDIR: profile,
};
delete env.ELECTRON_RUN_AS_NODE;

const args = [`--remote-debugging-port=${DEBUG_PORT}`];
if (process.platform === 'linux') args.push('--no-sandbox');

// Own process group, so the whole tree (AppImage runtime → Electron → its
// relay and helpers) can be stopped together afterwards.
const child = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
let output = '';
child.stdout.on('data', d => { output += d; });
child.stderr.on('data', d => { output += d; });
let exited = null;
child.on('exit', code => { exited = code; });

async function until(what, check) {
  const end = Date.now() + TIMEOUT_MS;
  let last;
  while (Date.now() < end) {
    if (exited !== null) throw new Error(`app exited (code ${exited}) while waiting for ${what}`);
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { last = error; }
    await delay(1000);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  try {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    const reply = await new Promise((resolve, reject) => {
      ws.onmessage = event => {
        const message = JSON.parse(String(event.data));
        if (message.id === 1) resolve(message);
      };
      ws.onerror = reject;
    });
    return reply.result?.result?.value;
  } finally { ws.close(); }
}

function stopTree(signal) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try { process.kill(-child.pid, signal); } catch { /* already gone */ }
}

let failed = false;
try {
  const health = await until('private relay /healthz', async () => {
    const res = await fetch(`${RELAY_INFO}/healthz`);
    return res.ok ? res.json() : null;
  });
  console.log('relay healthy:', JSON.stringify(health));

  const page = await until('app window', async () => {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const targets = await res.json();
    return targets.find(t => t.type === 'page' && /index\.html/.test(t.url));
  });
  console.log('window loaded:', page.url);

  const text = await until('rendered UI', async () => {
    const value = await evaluate(page.webSocketDebuggerUrl, 'document.body.innerText');
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  });
  console.log('rendered text:', text.trim().replace(/\s+/g, ' ').slice(0, 160));
  console.log('SMOKE PASS');
} catch (error) {
  failed = true;
  console.error('SMOKE FAIL:', error.message);
  console.error('--- app output ---\n' + output.slice(-4000));
} finally {
  stopTree('SIGTERM');
  await delay(3000);
  stopTree('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked on Windows */ }
}
process.exit(failed ? 1 : 0);
