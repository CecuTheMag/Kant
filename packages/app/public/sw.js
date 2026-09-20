/* Kant service worker — handles Web Push notifications when the tab is closed. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'Kant', body: e.data.text() }; }

  const title = payload.title ?? 'Kant';
  const options = {
    body: payload.body ?? 'New message',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag ?? 'kant-msg',
    data: payload.data ?? {},
    silent: false,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
