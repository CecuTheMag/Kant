/**
 * Small, dependency-free helpers shared by every screen: names and colours for
 * people, invite links, clipboard/share, theme, and a few interaction hooks.
 */
import { useEffect, useRef, useState } from 'react';
import type { Contact } from './core/types';
import type { ThemePref } from './core/store';

/* ── People ───────────────────────────────────────────────────────── */

export function shortId(hex: string): string {
  return `${hex.slice(0, 4)} ${hex.slice(4, 8)}`.toUpperCase();
}

export function displayName(c: Pick<Contact, 'nickname' | 'publicKeyHex'> | undefined | null): string {
  if (!c) return 'Unknown';
  return c.nickname?.trim() || `Kant ${shortId(c.publicKeyHex)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Stable hue per identity so a person keeps their colour everywhere. */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palette = [211, 262, 330, 14, 32, 145, 186, 232, 290, 4];
  return palette[h % palette.length];
}

export function groupedKey(hex: string, size = 4): string {
  return (hex.match(new RegExp(`.{1,${size}}`, 'g')) ?? []).join(' ');
}

/* ── Invite links ─────────────────────────────────────────────────── */

export const INVITE_BASE = 'https://kant.network/add';
const PENDING_INVITE_KEY = 'kant_pending_invite';

export interface Invite { hex: string; name?: string; relay?: string }

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch { return true; }
}

/** Everything after `#` stays on the device — it is never sent to kant.network. */
export function buildInvite({ hex, name, relay }: Invite): string {
  const p = new URLSearchParams();
  p.set('k', hex);
  if (name?.trim()) p.set('n', name.trim());
  if (relay && !isLoopback(relay)) p.set('r', relay);
  return `${INVITE_BASE}#${p.toString()}`;
}

/** Accepts an invite link (web or kant://), or anything containing a 64-hex key. */
export function parseInvite(text: string): Invite | null {
  const raw = text.trim();
  if (!raw) return null;
  const fragment = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  if (fragment) {
    const p = new URLSearchParams(fragment);
    const k = p.get('k')?.trim().toLowerCase();
    if (k && /^[0-9a-f]{64}$/.test(k)) {
      const relay = p.get('r') ?? undefined;
      return {
        hex: k,
        name: p.get('n')?.slice(0, 40) || undefined,
        relay: relay && /^https?:\/\//i.test(relay) ? relay.replace(/\/$/, '') : undefined,
      };
    }
  }
  const m = raw.match(/\b[0-9a-fA-F]{64}\b/);
  return m ? { hex: m[0].toLowerCase() } : null;
}

export function savePendingInvite(invite: Invite): void {
  try { localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(invite)); } catch { /* storage unavailable */ }
}

export function takePendingInvite(): Invite | null {
  try {
    const raw = localStorage.getItem(PENDING_INVITE_KEY);
    localStorage.removeItem(PENDING_INVITE_KEY);
    const invite = raw ? JSON.parse(raw) as Invite : null;
    return invite && /^[0-9a-f]{64}$/.test(invite.hex) ? invite : null;
  } catch { return null; }
}

/** Accepts "relay.example.com", "192.168.1.20:3001" or a full URL. Local and
 *  LAN addresses default to http (they rarely have certificates); everything
 *  else defaults to https. */
export function normalizeRelayUrl(input: string): string {
  const v = input.trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(v)) return v;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+\.local\b|[^.:]+(:\d+)?$)/i.test(v);
  return `${local ? 'http' : 'https'}://${v}`;
}

/* ── Clipboard & share ────────────────────────────────────────────── */

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The async clipboard needs a secure context; LAN http origins are not.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** Native share sheet when there is one; otherwise copy. Returns 'shared' | 'copied'. */
export async function shareOrCopy(data: { title?: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'cancelled'> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  await copyText(data.url);
  return 'copied';
}

/* ── Theme ────────────────────────────────────────────────────────── */

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem('kant_theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

/** Resolves the preference against the OS and keeps <html data-theme> in sync. */
export function useAppliedTheme(pref: ThemePref): 'light' | 'dark' {
  const query = '(prefers-color-scheme: dark)';
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#000000' : '#ffffff');
  }, [resolved]);
  return resolved;
}

/* ── Layout & interaction ─────────────────────────────────────────── */

export function useIsCompact(): boolean {
  const query = '(max-width: 767px)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

export const isTouch = () => window.matchMedia?.('(hover: none)').matches ?? false;

/**
 * Long-press for touch. Fires once after `ms` unless the finger moves (a scroll)
 * or lifts early. Returns handlers to spread onto the target element.
 */
export function useLongPress(onLongPress: (pos: { x: number; y: number }) => void, ms = 420) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const firedAt = useRef(0);
  const [pressed, setPressed] = useState(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
    setPressed(false);
  };
  return {
    pressed,
    /** True right after a long-press, so the trailing click / contextmenu can be ignored. */
    justFired: () => Date.now() - firedAt.current < 700,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
        setPressed(true);
        timer.current = window.setTimeout(() => {
          const pos = start.current;
          clear();
          if (pos) {
            firedAt.current = Date.now();
            navigator.vibrate?.(8);
            onLongPress(pos);
          }
        }, ms);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8) clear();
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
    },
  };
}

/* ── Formatting ───────────────────────────────────────────────────── */

export function listTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now.getTime() - ts < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

export function seenLabel(c: Pick<Contact, 'online' | 'lastSeen'>): string {
  if (c.online) return 'Online';
  if (!c.lastSeen) return '';
  const mins = Math.round((Date.now() - c.lastSeen) / 60_000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  const d = new Date(c.lastSeen);
  const today = new Date().toDateString() === d.toDateString();
  return `Last seen ${today ? 'today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
