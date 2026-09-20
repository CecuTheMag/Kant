/**
 * Raising a notification for a message that has already been decrypted locally.
 *
 * This is separate from `pushNotifications.ts`, which deals with FCM wake pings
 * from the relay. That path can only ever say "something arrived" because the
 * wake carries no content. This one runs when the app is alive and holds the
 * plaintext, so it can name the sender.
 *
 * The web `Notification` constructor cannot do this job on Android: it is absent
 * from the Capacitor WebView, so the old call sites failed silently and the user
 * saw nothing whenever the app was merely backgrounded rather than asleep.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface PermissionResult {
  granted: boolean;
  /** 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' */
  state: string;
}

interface KantNotificationsPlugin {
  notify(options: { title: string; body: string; tag?: string }): Promise<void>;
  checkPermission(): Promise<PermissionResult>;
  requestPermission(): Promise<PermissionResult>;
}

const Native = registerPlugin<KantNotificationsPlugin>('KantNotifications');

/** Current notification permission, without prompting. Never throws. */
export async function getNotificationPermission(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) return (await Native.checkPermission()).granted;
    if (typeof Notification === 'undefined') return false;
    return Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Make sure we are actually allowed to post notifications.
 *
 * Android 13+ silently drops every notification from an app that has not been
 * granted POST_NOTIFICATIONS. This used to be requested only as a side effect of
 * FCM registration, which happens after a relay circuit comes up — so anyone who
 * had not connected yet was never asked, and every notification the app raised
 * went nowhere. Ask directly instead, as soon as there is an unlocked identity.
 *
 * Returns whether notifications can be shown. Never throws.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const current = await Native.checkPermission();
      if (current.granted) return true;
      // 'denied' means the system will not prompt again; only app settings can
      // change it, so asking a second time would just be a silent no-op.
      if (current.state === 'denied') return false;
      return (await Native.requestPermission()).granted;
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** True when the user cannot currently see the conversation. */
export function appIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Show a notification, or do nothing if the platform will not allow it.
 * Never throws — a failed notification must not break message handling.
 *
 * `tag` groups notifications so an active conversation replaces its own entry
 * instead of stacking one per message.
 */
export async function showLocalNotification(
  title: string,
  body: string,
  tag?: string,
): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Native.notify({ title, body, tag });
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag });
    }
  } catch {
    // A notification is advisory. Losing one is not worth failing the message.
  }
}
