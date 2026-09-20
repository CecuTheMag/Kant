/**
 * Reflects the unread count in the window title.
 *
 * On desktop the app is usually one background tab or one window among many, so
 * an in-list badge is invisible until you go looking for it. Every other
 * messenger solves this the same way — the count rides in the title, which the
 * OS taskbar, the window switcher and the browser tab strip all surface for
 * free. Electron additionally gets a real dock/taskbar badge where the platform
 * supports one.
 *
 * Native mobile is excluded: Android draws its launcher badge from the
 * notification itself, and rewriting document.title there does nothing.
 */
import { useEffect } from 'react';

const BASE_TITLE = 'Kant';

export function useUnreadTitle(total: number): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    document.title = total > 0
      ? `(${total > 99 ? '99+' : total}) ${BASE_TITLE}`
      : BASE_TITLE;

    // Electron exposes a real badge; the web build has no equivalent API.
    const desktop = (window as any).kantDesktop;
    if (desktop?.setBadgeCount) {
      try { desktop.setBadgeCount(total); } catch { /* badge is advisory */ }
    }

    return () => { document.title = BASE_TITLE; };
  }, [total]);
}
