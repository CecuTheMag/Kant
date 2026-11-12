/**
 * Screen security — the JS half of KantScreenPlugin (Android).
 *
 * When on, Android keeps Kant out of screenshots, screen recordings and the
 * recent-apps preview. iOS gives apps no equivalent switch, and a browser or
 * desktop window can't prevent capture at all, so the setting only appears
 * where the native plugin exists.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface KantScreenPlugin {
  status(): Promise<{ enabled: boolean }>;
  setSecure(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
}

const KantScreen = registerPlugin<KantScreenPlugin>('KantScreen');

/** True where the window can actually be protected (Android builds with the plugin). */
export function screenSecuritySupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('KantScreen');
}

export async function getScreenSecurity(): Promise<boolean> {
  if (!screenSecuritySupported()) return false;
  try { return (await KantScreen.status()).enabled === true; } catch { return false; }
}

/** Turn screen security on or off. Returns the state now in effect. */
export async function setScreenSecurity(enabled: boolean): Promise<boolean> {
  if (!screenSecuritySupported()) return false;
  return (await KantScreen.setSecure({ enabled })).enabled === true;
}
