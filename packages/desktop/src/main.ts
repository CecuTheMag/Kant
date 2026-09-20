import {
  app, BrowserWindow, Tray, Menu, nativeImage,
  shell, ipcMain, Notification
} from 'electron';
import { join, resolve } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import * as os from 'os';
import * as net from 'net';
import { startAiServer, type AiServerHandle } from './ai-server.js';
import { defaultPermissions, type McpPermissions } from './mcp-server.js';

// Some Wayland/Intel combinations repeatedly crash Electron's GPU process
// before the renderer paints. The messenger UI is lightweight, so use the
// software compositor for a reliable desktop launch across Linux systems.
app.disableHardwareAcceleration();

// Dev mode: if KANT_DEV=1, or if running from source (dist-electron exists and not packaged)
const isDev = process.env.KANT_DEV === '1' || (!app.isPackaged && existsSync(join(__dirname, '../../app/dist')));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let relayProcess: ChildProcess | null = null;
let sharedRelayProcess: ChildProcess | null = null;
let sharedRelayPublicHost = '';
let publicRelayProcess: ChildProcess | null = null;
let publicRelayHost = '';
let relayLogs: string[] = [];

// ── AI (MCP) server state ─────────────────────────────────────────────────────

const AI_PORT = 8742;

interface AiConfig {
  enabled: boolean;
  token: string;
  permissions: McpPermissions;
}

let aiConfig: AiConfig = { enabled: false, token: '', permissions: defaultPermissions() };
let aiServer: AiServerHandle | null = null;

// Correlates an MCP tool call (main) with its reply from the renderer.
const aiPending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function aiConfigPath(): string {
  return join(app.getPath('userData'), 'ai-config.json');
}

function loadAiConfig(): void {
  try {
    const raw = readFileSync(aiConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    aiConfig = {
      enabled: !!parsed.enabled,
      token: typeof parsed.token === 'string' ? parsed.token : '',
      permissions: { ...defaultPermissions(), ...(parsed.permissions ?? {}) },
    };
  } catch { /* first run — keep defaults */ }
}

function saveAiConfig(): void {
  try { writeFileSync(aiConfigPath(), JSON.stringify(aiConfig, null, 2), { mode: 0o600 }); }
  catch (e) { console.error('[ai] failed to persist config', e); }
}

/** Proxy an MCP tool call to the renderer and await its reply over IPC. */
function callRenderer(method: string, params: unknown, timeoutMs = 20000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) { reject(new Error('Kant window is not ready')); return; }
    const callId = randomUUID();
    const timer = setTimeout(() => { aiPending.delete(callId); reject(new Error('renderer call timed out')); }, timeoutMs);
    aiPending.set(callId, { resolve, reject, timer });
    mainWindow.webContents.send('ai:call', { callId, method, params });
  });
}

async function applyAiServer(): Promise<void> {
  const shouldRun = aiConfig.enabled && !!aiConfig.token;
  if (shouldRun && !aiServer) {
    aiServer = await startAiServer({
      port: AI_PORT,
      getToken: () => aiConfig.token,
      getPermissions: () => aiConfig.permissions,
      call: callRenderer,
      fileRoot: app.getPath('downloads'),
      maxFileSize: 100 * 1024 * 1024,
      onAudit: (entry) => {
        console.log('[ai-audit]', entry.tool, entry.ok ? 'ok' : `ERR:${entry.error}`, '—', entry.summary);
        mainWindow?.webContents.send('ai:audit', entry);
      },
    });
    console.log(`[ai] MCP server listening on http://127.0.0.1:${AI_PORT}/mcp`);
  } else if (!shouldRun && aiServer) {
    await aiServer.close();
    aiServer = null;
    console.log('[ai] MCP server stopped');
  }
}

function generateAiToken(): string {
  return randomBytes(32).toString('base64url');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalIp(): string {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

function waitForPort(port: number, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const try_ = () => {
      const s = net.createConnection(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() < deadline) setTimeout(try_, 300);
        else reject(new Error(`port ${port} not ready after ${timeout}ms`));
      });
    };
    try_();
  });
}

function relayScript() {
  return isDev
    ? resolve(__dirname, '../../relay/dist/index.js')
    : join(process.resourcesPath, 'relay', 'dist', 'index.js');
}

/**
 * The packaged desktop binary is Electron, not a standalone Node executable.
 * Relay processes run the regular Node relay entrypoint, so explicitly switch
 * Electron into Node mode. Without this the child starts a second Electron
 * process (and the relay exits before opening its ports).
 */
function relayEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...overrides };
}

/** Relay seeds and logs must never be written inside a mounted AppImage. */
function relayDataDir(name: string): string {
  return join(app.getPath('userData'), 'relay', name);
}

// ── Private relay (local only, always-on for the app itself) ──────────────────

function startRelay() {
  const script = relayScript();
  if (!existsSync(script)) {
    console.warn('[relay] script not found at', script, '— skipping auto-start');
    return;
  }

  relayProcess = spawn(process.execPath, [script], {
    env: relayEnv({
      RELAY_PORT: '3000',
      RELAY_INFO_PORT: '3001',
      RELAY_DATA_DIR: relayDataDir('private'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  relayProcess.stdout?.on('data', (d: Buffer) => console.log('[relay]', d.toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 500)));
  relayProcess.stderr?.on('data', (d: Buffer) => console.error('[relay]', d.toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 500)));
  relayProcess.on('exit', (code) => { console.log('[relay] exited', Number(code)); relayProcess = null; });
  console.log('[relay] started, pid', relayProcess.pid);
}

function stopRelay() {
  relayProcess?.kill();
  relayProcess = null;
}

// ── Shared relay (LAN/internet-visible, opt-in) ───────────────────────────────

async function startSharedRelay(): Promise<{ ok: boolean; url: string; error?: string }> {
  if (sharedRelayProcess) return { ok: true, url: `http://${sharedRelayPublicHost}:3011` };

  const script = relayScript();
  if (!existsSync(script)) return { ok: false, url: '', error: 'relay script not found' };

  const ip = getLocalIp();
  sharedRelayPublicHost = ip;

  sharedRelayProcess = spawn(process.execPath, [script], {
    env: relayEnv({
      RELAY_PORT: '3010',
      RELAY_INFO_PORT: '3011',
      RELAY_PUBLIC_HOST: ip,
      RELAY_HTTP_BIND: '0.0.0.0',
      RELAY_DATA_DIR: relayDataDir('shared'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  sharedRelayProcess.stdout?.on('data', (d: Buffer) => console.log('[shared-relay]', d.toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 500)));
  sharedRelayProcess.stderr?.on('data', (d: Buffer) => console.error('[shared-relay]', d.toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 500)));
  sharedRelayProcess.on('exit', (code) => { console.log('[shared-relay] exited', Number(code)); sharedRelayProcess = null; updateTray(); });

  try {
    await waitForPort(3011);
    updateTray();
    return { ok: true, url: `http://${ip}:3011` };
  } catch (e: any) {
    sharedRelayProcess?.kill();
    sharedRelayProcess = null;
    return { ok: false, url: '', error: e.message };
  }
}

function stopSharedRelay() {
  sharedRelayProcess?.kill();
  sharedRelayProcess = null;
  sharedRelayPublicHost = '';
  updateTray();
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'Kant',
    backgroundColor: '#17212b',
    titleBarStyle: 'hiddenInset',
    frame: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: getIconPath(),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Try loading from file, but if that fails, fall back to localhost dev server
    const appPath = join(process.resourcesPath, 'app', 'index.html');
    if (existsSync(appPath)) {
      mainWindow.loadFile(appPath);
    } else {
      // Fallback to dev server if packaged app not found
      mainWindow.loadURL('http://localhost:5173');
    }
  }

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function updateTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Kant', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: relayProcess ? '🟢 Private relay running' : '🔴 Private relay stopped', enabled: false },
    { label: sharedRelayProcess ? `🟢 Shared relay: ${sharedRelayPublicHost}:3010` : '⚪ Shared relay off', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const icon = nativeImage.createFromPath(getIconPath());
  const trayIcon = icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('Kant — Private Messenger');
  updateTray();
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.focus();
    else mainWindow?.show();
  });
}

// ── Icon path ─────────────────────────────────────────────────────────────────

function getIconPath(): string {
  const candidates = [
    join(__dirname, '../assets/icon.png'),
    join(process.resourcesPath ?? '', 'assets/icon.png'),
    join(__dirname, '../../assets/icon.png'),
  ];
  return candidates.find(existsSync) ?? '';
}

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-relay-status', () => ({
  running: relayProcess !== null,
  pid: relayProcess?.pid ?? null,
  sharedRunning: sharedRelayProcess !== null,
  sharedUrl: sharedRelayProcess ? `http://${sharedRelayPublicHost}:3011` : null,
  publicRunning: publicRelayProcess !== null,
  publicHost: publicRelayHost ?? null,
}));

ipcMain.handle('start-shared-relay', () => startSharedRelay());

ipcMain.handle('stop-shared-relay', () => { stopSharedRelay(); return { ok: true }; });

ipcMain.handle('detect-public-ip', async () => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(id);
    const data: any = await response.json();
    return { ok: true, ip: data.ip };
  } catch (e: any) {
    return { ok: false, ip: '', error: e.message };
  }
});

/** Validate that a host string is a safe IPv4, IPv6, or hostname — no injection. */
function isValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host.split('.').every(n => parseInt(n) <= 255);
  }
  // IPv6 (bare, no brackets)
  if (/^[0-9a-fA-F:]+$/.test(host) && host.includes(':')) return true;
  // Hostname: letters, digits, hyphens, dots only
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]{0,251}[a-zA-Z0-9])?$/.test(host);
}

ipcMain.handle('start-public-relay', async (_e, publicHost: string) => {
  if (typeof publicHost !== 'string' || !isValidHost(publicHost)) {
    return { ok: false, url: '', error: 'invalid host' };
  }
  if (publicRelayProcess) return { ok: true, url: `http://${publicHost}:3021` };

  const script = relayScript();
  if (!existsSync(script)) return { ok: false, url: '', error: 'relay script not found' };

  publicRelayHost = publicHost;
  relayLogs = [];

  publicRelayProcess = spawn(process.execPath, [script], {
    env: relayEnv({
      RELAY_PORT: '3020',
      RELAY_INFO_PORT: '3021',
      RELAY_PUBLIC_HOST: publicHost,
      RELAY_HTTP_BIND: '0.0.0.0',
      RELAY_DATA_DIR: relayDataDir('public'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  publicRelayProcess.stdout?.on('data', (d: Buffer) => {
    const msg = d.toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    relayLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (relayLogs.length > 100) relayLogs.shift();
    mainWindow?.webContents.send('relay-log', msg);
    console.log('[public-relay]', msg);
  });

  publicRelayProcess.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    relayLogs.push(`[${new Date().toLocaleTimeString()}] ERROR: ${msg}`);
    if (relayLogs.length > 100) relayLogs.shift();
    mainWindow?.webContents.send('relay-log', msg);
    console.error('[public-relay]', msg);
  });

  publicRelayProcess.on('exit', (code) => {
    console.log('[public-relay] exited', Number(code));
    publicRelayProcess = null;
    publicRelayHost = '';
    mainWindow?.webContents.send('relay-stopped');
  });

  try {
    await waitForPort(3021);
    mainWindow?.webContents.send('relay-started', `http://${publicHost}:3021`);
    return { ok: true, url: `http://${publicHost}:3021` };
  } catch (e: any) {
    publicRelayProcess?.kill();
    publicRelayProcess = null;
    publicRelayHost = '';
    return { ok: false, url: '', error: e.message };
  }
});

ipcMain.handle('stop-public-relay', () => {
  publicRelayProcess?.kill();
  publicRelayProcess = null;
  publicRelayHost = '';
  mainWindow?.webContents.send('relay-stopped');
  return { ok: true };
});

ipcMain.handle('get-relay-logs', () => relayLogs);

ipcMain.handle('show-notification', (_e, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: getIconPath() }).show();
  }
});

/**
 * Unread count on the dock/taskbar icon.
 *
 * macOS and most Linux desktops (Unity launcher API) render this; Windows has
 * no equivalent for a plain count, so Electron ignores it there. The window
 * title carries the count on every platform regardless, so a no-op here only
 * costs the icon overlay, never the signal itself.
 */
ipcMain.handle('set-badge-count', (_e, count: number) => {
  try {
    app.setBadgeCount(Math.max(0, Math.floor(count) || 0));
  } catch {
    // Unsupported platform — the title badge still shows the count.
  }
});

// ── AI (MCP) bridge IPC ────────────────────────────────────────────────────────

// Renderer replies to a proxied tool call.
ipcMain.on('ai:result', (_e, msg: { callId: string; ok: boolean; result?: any; error?: string }) => {
  const p = aiPending.get(msg.callId);
  if (!p) return;
  clearTimeout(p.timer);
  aiPending.delete(msg.callId);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error || 'renderer error'));
});

// Renderer forwards an inbound message event; surface it to connected agents.
ipcMain.on('ai:notify', (_e, data: unknown) => { aiServer?.broadcastLog(data); });

ipcMain.handle('ai:get-config', () => ({
  enabled: aiConfig.enabled,
  token: aiConfig.token,
  permissions: aiConfig.permissions,
  port: AI_PORT,
  running: aiServer !== null,
  endpoint: `http://127.0.0.1:${AI_PORT}/mcp`,
}));

ipcMain.handle('ai:set-enabled', async (_e, enabled: boolean) => {
  aiConfig.enabled = !!enabled;
  if (aiConfig.enabled && !aiConfig.token) aiConfig.token = generateAiToken();
  saveAiConfig();
  await applyAiServer();
  return { enabled: aiConfig.enabled, token: aiConfig.token, running: aiServer !== null };
});

ipcMain.handle('ai:regenerate-token', async () => {
  aiConfig.token = generateAiToken();
  saveAiConfig();
  // Restart so existing sessions authenticated with the old token are dropped.
  if (aiServer) { await aiServer.close(); aiServer = null; }
  await applyAiServer();
  return { token: aiConfig.token, running: aiServer !== null };
});

ipcMain.handle('ai:set-permissions', (_e, perms: Partial<McpPermissions>) => {
  aiConfig.permissions = { ...defaultPermissions(), ...aiConfig.permissions, ...perms };
  saveAiConfig();
  return aiConfig.permissions;
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

declare global {
  namespace Electron {
    interface App { isQuitting: boolean; }
  }
}
app.isQuitting = false;

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    loadAiConfig();
    startRelay();
    createWindow();
    createTray();
    // Resume the MCP server if the user previously enabled it. Tools that reach
    // the renderer will queue until the window has loaded and registered its
    // ai:call handler; the call timeout guards against a never-ready window.
    await applyAiServer().catch((e) => console.error('[ai] failed to start server', e));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // On Linux/Windows keep running in tray
    if (process.platform === 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    stopRelay();
    stopSharedRelay();
    aiServer?.close().catch(() => { /* shutting down */ });
    aiServer = null;
  });
}
