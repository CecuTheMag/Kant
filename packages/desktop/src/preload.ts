import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kantDesktop', {
  getRelayStatus: () => ipcRenderer.invoke('get-relay-status'),
  startSharedRelay: () => ipcRenderer.invoke('start-shared-relay'),
  stopSharedRelay: () => ipcRenderer.invoke('stop-shared-relay'),
  detectPublicIp: () => ipcRenderer.invoke('detect-public-ip'),
  startPublicRelay: (host: string) => ipcRenderer.invoke('start-public-relay', host),
  stopPublicRelay: () => ipcRenderer.invoke('stop-public-relay'),
  getRelayLogs: () => ipcRenderer.invoke('get-relay-logs'),
  onRelayLog: (callback: (msg: string) => void) => ipcRenderer.on('relay-log', (_, msg) => callback(msg)),
  onRelayStarted: (callback: (url: string) => void) => ipcRenderer.on('relay-started', (_, url) => callback(url)),
  onRelayStopped: (callback: () => void) => ipcRenderer.on('relay-stopped', callback),
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('show-notification', title, body),
  /** Unread count for the dock/taskbar icon. No-op where the OS has no badge. */
  setBadgeCount: (count: number) => ipcRenderer.invoke('set-badge-count', count),
  platform: process.platform,
  isDesktop: true,

  // ── AI (MCP) bridge ──────────────────────────────────────────────────────────
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('ai:set-enabled', enabled),
    regenerateToken: () => ipcRenderer.invoke('ai:regenerate-token'),
    setPermissions: (perms: Record<string, boolean>) => ipcRenderer.invoke('ai:set-permissions', perms),
    /** Register the handler that services proxied MCP tool calls. Returns an unsubscribe fn. */
    onCall: (cb: (msg: { callId: string; method: string; params: any }) => void) => {
      const listener = (_e: unknown, msg: any) => cb(msg);
      ipcRenderer.on('ai:call', listener);
      return () => ipcRenderer.removeListener('ai:call', listener);
    },
    sendResult: (callId: string, ok: boolean, result?: unknown, error?: string) =>
      ipcRenderer.send('ai:result', { callId, ok, result, error }),
    /** Surface an inbound-message event to connected agents. */
    notify: (data: unknown) => ipcRenderer.send('ai:notify', data),
    onAudit: (cb: (entry: any) => void) => {
      const listener = (_e: unknown, entry: any) => cb(entry);
      ipcRenderer.on('ai:audit', listener);
      return () => ipcRenderer.removeListener('ai:audit', listener);
    },
  },
});
