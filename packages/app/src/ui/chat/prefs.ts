/**
 * Chat preferences (Settings → Chats). Device-local UI choices — nothing here
 * is sent anywhere — kept in localStorage and shared by every component
 * through useChatPrefs().
 */
import { useSyncExternalStore } from 'react';
import { QUICK_REACTIONS } from './chatLogic';

export interface ChatPrefs {
  /** Show **bold**, _italic_, lists, code… in messages instead of the raw characters. */
  formatting: boolean;
  /** Show the formatting bar above the keyboard when text is selected. */
  formatBar: boolean;
  /** Swipe a message to the right to reply to it. */
  swipeReply: boolean;
  /** Double-tap a message to react with `quickReaction`. */
  doubleTapReact: boolean;
  quickReaction: string;
  /** Ask before a link leaves the app (the site sees your IP address). */
  confirmLinks: boolean;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  formatting: true,
  formatBar: true,
  swipeReply: true,
  doubleTapReact: true,
  quickReaction: '❤️',
  confirmLinks: true,
};

const KEY = 'kant-chat-prefs';
const listeners = new Set<() => void>();
let current: ChatPrefs = load();

function load(): ChatPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof ChatPrefs, unknown>>;
    const out = { ...DEFAULT_CHAT_PREFS };
    for (const key of Object.keys(DEFAULT_CHAT_PREFS) as (keyof ChatPrefs)[]) {
      if (typeof raw[key] === typeof DEFAULT_CHAT_PREFS[key]) (out as Record<string, unknown>)[key] = raw[key];
    }
    if (!(QUICK_REACTIONS as readonly string[]).includes(out.quickReaction)) out.quickReaction = DEFAULT_CHAT_PREFS.quickReaction;
    return out;
  } catch {
    return { ...DEFAULT_CHAT_PREFS };
  }
}

export function setChatPrefs(patch: Partial<ChatPrefs>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep for this session */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatPrefs(): ChatPrefs {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
