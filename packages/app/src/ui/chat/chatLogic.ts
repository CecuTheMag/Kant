/**
 * Pure helpers behind the chat gestures and the composer's formatting — kept
 * free of DOM and React so they are unit-tested (chatLogic.test.ts).
 */

import { inlineText, parseMarkdown } from '../preview/markdown';
import type { Block } from '../preview/markdown';

/**
 * A message as plain text, formatting markers removed — for one-line places
 * (reply quotes, the chat list) where `**bold**` would just be noise.
 */
export function plainText(text: string): string {
  if (!/[*_~`#>|[\\-]|^\s*\d+[.)]\s/m.test(text)) return text;
  const lines: string[] = [];
  const walk = (blocks: Block[], indent: string) => {
    for (const b of blocks) {
      switch (b.t) {
        case 'heading': case 'para': lines.push(indent + inlineText(b.c)); break;
        case 'code': lines.push(indent + b.v); break;
        case 'quote': walk(b.c, indent); break;
        case 'hr': break;
        case 'list': b.items.forEach((item, i) => {
          const mark = b.ordered ? `${b.start + i}. ` : '• ';
          const [first, ...rest] = item.c;
          lines.push(indent + mark + (first?.t === 'para' ? inlineText(first.c) : ''));
          walk(first?.t === 'para' ? rest : item.c, indent + '  ');
        }); break;
        case 'table': for (const row of [b.head, ...b.rows]) lines.push(indent + row.map(inlineText).join(' | ')); break;
      }
    }
  };
  walk(parseMarkdown(text, { breaks: true }), '');
  return lines.join('\n');
}

/** The reactions offered one tap away (long-press menu, hover button). */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** The fuller set behind "+" in the reaction bar. */
export const MORE_REACTIONS = [
  '😀', '😁', '😅', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😏',
  '🤔', '🤨', '😐', '🙄', '😬', '😴', '😭', '😡', '🤯', '😱', '🥺', '🤗',
  '👏', '🙌', '👌', '✌️', '🤝', '💪', '👀', '🔥', '✨', '🎉', '💯', '✅',
  '❌', '⚡', '💡', '📌', '🎯', '🚀', '☕', '🍕', '🍻', '💔', '💙', '💚',
] as const;

export interface ReactionSummary { emoji: string; count: number; mine: boolean; who: string[] }

/** `{ who: emoji }` → one chip per emoji, most used first (ties: first reacted). */
export function summarizeReactions(reactions: Record<string, string> | undefined): ReactionSummary[] {
  if (!reactions) return [];
  const byEmoji = new Map<string, ReactionSummary>();
  for (const [who, emoji] of Object.entries(reactions)) {
    if (!emoji) continue;
    const entry = byEmoji.get(emoji) ?? { emoji, count: 0, mine: false, who: [] };
    entry.count += 1;
    entry.who.push(who);
    if (who === 'me') entry.mine = true;
    byEmoji.set(emoji, entry);
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}

/** What tapping `emoji` does to your reaction: the same one again removes it. */
export function toggledReaction(current: string | undefined, emoji: string): string {
  return current === emoji ? '' : emoji;
}

/* ── Swipe to reply ─────────────────────────────────────────────────── */

/** How far a bubble must be dragged to reply, and how far it can travel. */
export const SWIPE = { lockAfter: 10, trigger: 56, max: 76 } as const;

/**
 * Decide what a touch drag is. Returns 'pending' until it has moved far enough
 * to tell, 'scroll' for a vertical (or leftward) drag the list should keep,
 * and 'swipe' for a rightward drag that belongs to swipe-to-reply.
 */
export function classifyDrag(dx: number, dy: number): 'pending' | 'scroll' | 'swipe' {
  if (Math.hypot(dx, dy) < SWIPE.lockAfter) return 'pending';
  return dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.4 ? 'swipe' : 'scroll';
}

/** Rubber-banded offset for a horizontal drag of `dx` px. */
export function swipeOffset(dx: number): number {
  if (dx <= 0) return 0;
  if (dx <= SWIPE.trigger) return dx;
  return Math.min(SWIPE.max, SWIPE.trigger + (dx - SWIPE.trigger) * 0.35);
}

/* ── Composer formatting ────────────────────────────────────────────── */

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'quote' | 'list';

export interface TextEdit { value: string; start: number; end: number }

const WRAP: Record<'bold' | 'italic' | 'strike' | 'code', string> = { bold: '**', italic: '_', strike: '~~', code: '`' };

/**
 * Apply a formatting command to the selection [start, end) of `value`, the
 * way chat composers do: inline styles wrap the selection (or unwrap it when
 * it is already wrapped), block styles prefix every selected line (or remove
 * the prefix when every line already has it). Whitespace at the selection's
 * edges stays outside the markers — `** bold**` is not bold in Markdown.
 */
export function applyFormat(value: string, start: number, end: number, kind: FormatKind): TextEdit {
  const lo = Math.max(0, Math.min(start, end, value.length));
  const hi = Math.min(value.length, Math.max(start, end));

  if (kind === 'quote' || kind === 'list') {
    const prefix = kind === 'quote' ? '> ' : '- ';
    const lineStart = value.lastIndexOf('\n', lo - 1) + 1;
    const nextBreak = value.indexOf('\n', hi > lo && value[hi - 1] === '\n' ? hi - 1 : hi);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const all = lines.every(l => l.startsWith(prefix) || !l.trim());
    const next = lines.map(l => (!l.trim() ? l : all ? l.slice(prefix.length) : l.startsWith(prefix) ? l : prefix + l)).join('\n');
    const out = value.slice(0, lineStart) + next + value.slice(lineEnd);
    return { value: out, start: lineStart, end: lineStart + next.length };
  }

  const marker = WRAP[kind];
  const m = marker.length;
  // Already wrapped just outside the selection → unwrap.
  if (lo >= m && value.slice(lo - m, lo) === marker && value.slice(hi, hi + m) === marker) {
    return { value: value.slice(0, lo - m) + value.slice(lo, hi) + value.slice(hi + m), start: lo - m, end: hi - m };
  }
  const selected = value.slice(lo, hi);
  // Selection itself includes the markers → unwrap.
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { value: value.slice(0, lo) + inner + value.slice(hi), start: lo, end: lo + inner.length };
  }
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const core = selected.trim();
  if (!core) {
    // Nothing selected: insert a pair of markers with the caret between them.
    const out = value.slice(0, lo) + marker + marker + value.slice(hi);
    return { value: out, start: lo + m, end: lo + m };
  }
  const wrapped = selected.slice(0, lead) + marker + core + marker + selected.slice(selected.length - trail);
  const out = value.slice(0, lo) + wrapped + value.slice(hi);
  return { value: out, start: lo + lead + m, end: lo + lead + m + core.length };
}

/** Keyboard shortcut → formatting command (Ctrl on Windows/Linux, ⌘ on macOS). */
export function formatForShortcut(key: string, mod: boolean, shift: boolean): FormatKind | null {
  if (!mod) return null;
  const k = key.toLowerCase();
  if (k === 'b' && !shift) return 'bold';
  if (k === 'i' && !shift) return 'italic';
  if (k === 'x' && shift) return 'strike';
  if (k === 'e' && !shift) return 'code';
  return null;
}
