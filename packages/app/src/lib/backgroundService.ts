/**
 * Android background connection — the JS half of KantConnectionService.
 *
 * Kant's libp2p node runs inside the WebView, so it only lives as long as the
 * app's process does. Backgrounded processes are frozen or killed quickly, which
 * silently drops the relay socket and the circuit reservation. A foreground
 * service tells Android to leave the process alone, at the price of an ongoing
 * notification — which doubles as the honest disclosure that a connection is
 * being held, and carries the Stop action that revokes it.
 *
 * Every export is a no-op off Android, so callers need no platform branching.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface KantConnectionPlugin {
  start(options: { status: string }): Promise<{ started: boolean; reason?: string }>;
  updateStatus(options: { status: string }): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;
  isBatteryOptimized(): Promise<{ optimized: boolean }>;
  openBatterySettings(): Promise<void>;
  addListener(
    event: 'stopRequested',
    handler: () => void,
  ): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<KantConnectionPlugin>('KantConnection');

/** The service only exists on Android; everywhere else these calls are inert. */
function supported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** Human-readable connection state, shown as the notification's body text. */
export type BackgroundStatus = 'connecting' | 'connected' | 'offline';

const STATUS_TEXT: Record<BackgroundStatus, string> = {
  connecting: 'Connecting to relay…',
  connected:  'Connected to relay',
  offline:    'Offline — not connected',
};

/**
 * Enter the foreground state.
 *
 * Android 12+ rejects a foreground-service start from the background, so this
 * must be called while the app is on screen. A refusal is reported, never
 * thrown: losing the background connection degrades the app, it does not break
 * it, and node startup must not fail because of it.
 */
export async function startBackgroundService(status: BackgroundStatus): Promise<boolean> {
  if (!supported()) return false;
  try {
    const { started } = await Native.start({ status: STATUS_TEXT[status] });
    return started;
  } catch {
    return false;
  }
}

/** Repaint the notification. Safe to call when the service is not running. */
export async function updateBackgroundStatus(status: BackgroundStatus): Promise<void> {
  if (!supported()) return;
  try { await Native.updateStatus({ status: STATUS_TEXT[status] }); } catch { /* cosmetic */ }
}

/** Leave the foreground state and clear the notification. */
export async function stopBackgroundService(): Promise<void> {
  if (!supported()) return;
  try { await Native.stop(); } catch { /* already gone */ }
}

/**
 * Register the handler for the notification's Stop action.
 * Returns an unsubscribe function; a no-op off Android.
 */
export async function onBackgroundStopRequested(handler: () => void): Promise<() => void> {
  if (!supported()) return () => {};
  try {
    const listener = await Native.addListener('stopRequested', handler);
    return () => { void listener.remove(); };
  } catch {
    return () => {};
  }
}

/** Whether the foreground service currently holds the process. */
export async function isBackgroundServiceRunning(): Promise<boolean> {
  if (!supported()) return false;
  try { return (await Native.isRunning()).running; } catch { return false; }
}

/**
 * Whether Doze is still allowed to suspend this app.
 *
 * A foreground service keeps the process resident but does not exempt it from
 * Doze, which can cut network access after the screen has been off for a while.
 * Only the user can grant that exemption.
 */
export async function isBatteryOptimized(): Promise<boolean> {
  if (!supported()) return false;
  try { return (await Native.isBatteryOptimized()).optimized; } catch { return false; }
}

/** Open this app's system settings page so the user can lift the restriction. */
export async function openBatterySettings(): Promise<void> {
  if (!supported()) return;
  try { await Native.openBatterySettings(); } catch { /* nothing to do */ }
}
