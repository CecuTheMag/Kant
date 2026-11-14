/**
 * Status bar and navigation bar colours — the JS half of KantScreenPlugin.setBars
 * (Android). The bars should always match the pixels next to them; elsewhere
 * (iOS, desktop, browsers) the system handles this and every call is a no-op.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface BarOptions { color: string; dark: boolean; navColor: string; navDark: boolean }
interface KantScreenBars { setBars(options: BarOptions): Promise<void> }

const KantScreen = registerPlugin<KantScreenBars>('KantScreen');

let base = { color: '#000000', dark: true };
let sheets = 0;
let last = '';

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function apply(): void {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('KantScreen')) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  // Behind a sheet the app shrinks onto black; the sheet itself reaches the bottom edge.
  const options: BarOptions = sheets > 0
    ? { color: '#000000', dark: true, navColor: dark ? '#1c1c1e' : token('--bg-grouped', '#f2f2f7'), navDark: dark }
    : { color: base.color, dark: base.dark, navColor: base.color, navDark: base.dark };
  const key = JSON.stringify(options);
  if (key === last) return;
  last = key;
  void KantScreen.setBars(options).catch(() => { last = ''; });
}

/** The screen's own background: `'--bg'` for chats and setup, `'--bg-grouped'` for settings. */
export function setBarsFor(background: '--bg' | '--bg-grouped'): void {
  const dark = document.documentElement.dataset.theme === 'dark';
  base = { color: token(background, dark ? '#000000' : '#ffffff'), dark };
  apply();
}

/** A full-width sheet opened (true) or closed (false) over the screen. */
export function coverBars(on: boolean): void {
  sheets = Math.max(0, sheets + (on ? 1 : -1));
  apply();
}
