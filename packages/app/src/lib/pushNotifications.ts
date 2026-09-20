/**
 * pushNotifications.ts
 *
 * Signal-style push notifications.
 *
 * On Android (Capacitor): Firebase Messaging delivers an empty wake-up ping
 * from the relay. KantMessagingService.java shows the local notification.
 * This module gets the FCM token and registers it with the relay.
 *
 * On desktop browser (PWA): falls back to the Web Push / service worker path.
 * The relay sends a minimal encrypted push via the Web Push protocol.
 *
 * In both cases the FCM/push payload contains NO message content — it is a
 * wake signal only. The actual message arrives over the libp2p channel after
 * the app reconnects.
 */

import { Capacitor } from '@capacitor/core';

const SW_PATH = '/sw.js';

/** True when running inside a Capacitor Android/iOS WebView. */
function isCapacitor(): boolean {
  return Capacitor.isNativePlatform();
}

export async function setupPushNotifications(relayHttpUrl: string, identityKeyHex: string): Promise<void> {
  if (isCapacitor()) {
    await setupCapacitorPush(relayHttpUrl, identityKeyHex);
  } else {
    await setupWebPush(relayHttpUrl, identityKeyHex);
  }
}

export async function teardownPushNotifications(relayHttpUrl: string, identityKeyHex: string): Promise<void> {
  // Stop the persistent registration listener from re-registering this identity
  // if FCM rotates the token after the user signs out.
  pushTarget = null;
  try {
    const base = relayHttpUrl.replace(/\/$/, '');
    await fetch(`${base}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identityKeyHex }),
    });
  } catch { /* best-effort */ }

  if (!isCapacitor()) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration(SW_PATH);
      const sub = await reg?.pushManager?.getSubscription();
      await sub?.unsubscribe();
    } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------------ *
 * Capacitor (Android / iOS) — FCM token path
 * ------------------------------------------------------------------ */

/**
 * The relay/identity the persistent listener should register against. Kept in a
 * module-level cell so a reconnect to a different relay retargets the existing
 * listener rather than installing a second one.
 */
let pushTarget: { relayHttpUrl: string; identityKeyHex: string } | null = null;
let listenersInstalled = false;

async function setupCapacitorPush(relayHttpUrl: string, identityKeyHex: string): Promise<void> {
  try {
    // Dynamically import so the desktop build doesn't fail if the plugin
    // isn't installed (it's an optional native dependency).
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Request permission.
    const { receive } = await PushNotifications.requestPermissions();
    if (receive !== 'granted') return;

    pushTarget = { relayHttpUrl, identityKeyHex };

    // The listeners live for the lifetime of the app, deliberately.
    //
    // FCM emits 'registration' whenever the token is issued *or rotated*, and
    // the first issuance on a cold install can take well over ten seconds on a
    // slow network. Tearing the listener down after register() resolves — or
    // after a fixed timeout — drops exactly those events, and the device then
    // never registers a token and never receives a notification.
    if (!listenersInstalled) {
      listenersInstalled = true;
      await PushNotifications.addListener('registration', (token) => {
        const target = pushTarget;
        if (!target) return;
        void registerTokenWithRelay(target.relayHttpUrl, target.identityKeyHex, token.value, 'fcm')
          .catch((err) => console.warn('[push] token registration failed', err));
      });
      await PushNotifications.addListener('registrationError', (err) => {
        console.warn('[push] FCM registration error', err);
      });
    }

    // Idempotent: re-registering an already-registered device re-emits the
    // current token, which refreshes it on a relay that restarted.
    await PushNotifications.register();
  } catch (err) {
    console.warn('[push] capacitor setup failed', err);
  }
}

/* ------------------------------------------------------------------ *
 * Browser (PWA) — Web Push / service worker path
 * ------------------------------------------------------------------ */

async function setupWebPush(relayHttpUrl: string, identityKeyHex: string): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
    await navigator.serviceWorker.ready;

    const base = relayHttpUrl.replace(/\/$/, '');
    let key = '';
    try {
      const res = await fetch(`${base}/push/vapid-public-key`);
      if (res.ok) ({ key } = await res.json() as { key: string });
    } catch { /* relay may not have VAPID configured */ }
    if (!key) return; // VAPID not configured on this relay — skip silently

    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(key),
    });

    await registerTokenWithRelay(relayHttpUrl, identityKeyHex, JSON.stringify(sub.toJSON()), 'webpush');
  } catch (err) {
    console.warn('[push] web push setup failed', err);
  }
}

/* ------------------------------------------------------------------ *
 * Shared — send token/subscription to relay
 * ------------------------------------------------------------------ */

async function registerTokenWithRelay(
  relayHttpUrl: string,
  identityKeyHex: string,
  token: string,
  type: 'fcm' | 'webpush',
): Promise<void> {
  const base = relayHttpUrl.replace(/\/$/, '');
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${base}/push/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identityKeyHex, token, type }),
      });
      if (response.ok) return;
      error = new Error(`push subscription rejected with HTTP ${response.status}`);
    } catch (caught) {
      error = caught;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw error;
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer as ArrayBuffer;
}
