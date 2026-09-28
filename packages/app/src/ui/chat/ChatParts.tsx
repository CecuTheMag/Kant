/**
 * Pieces of the conversation view: formatted message text, reactions (the bar
 * in the long-press menu and the chips under a bubble), the composer's
 * formatting bar, the swipe/double-tap gestures and the delete sheet.
 */
import { memo, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { parseMarkdown } from '../preview/markdown';
import { Markdown } from '../preview/Markdown';
import { Sheet } from '../parts';
import { Plus } from '../icons';
import { useChatPrefs } from './prefs';
import {
  MORE_REACTIONS, QUICK_REACTIONS, SWIPE, classifyDrag, summarizeReactions, swipeOffset,
} from './chatLogic';
import type { FormatKind } from './chatLogic';

/* ── Message text ─────────────────────────────────────────────────── */

/**
 * A message's text, with formatting when that's switched on. The Markdown
 * renderer is inert (no HTML, no remote images) and links go through `onLink`,
 * which asks before anything leaves the app.
 */
export const ChatText = memo(function ChatText({ text, onLink }: { text: string; onLink: (href: string) => void }) {
  const { formatting } = useChatPrefs();
  const blocks = useMemo(() => (formatting ? parseMarkdown(text, { breaks: true }) : null), [text, formatting]);
  if (!blocks) return <>{text}</>;
  return <Markdown blocks={blocks} onLink={onLink} className="k-md-chat" />;
});

/* ── Reactions ────────────────────────────────────────────────────── */

/** The emoji row at the top of a message's menu. `current` is your reaction. */
export function ReactionBar({ current, onPick }: { current?: string; onPick: (emoji: string) => void }) {
  const [more, setMore] = useState(false);
  const list = more ? MORE_REACTIONS : QUICK_REACTIONS;
  return (
    <div className={`k-react-bar${more ? ' is-more' : ''}`} role="group" aria-label="React">
      {list.map((emoji) => (
        <button key={emoji} type="button" className={`k-react-pick${current === emoji ? ' is-mine' : ''}`}
          aria-label={current === emoji ? `Remove ${emoji}` : `React ${emoji}`} aria-pressed={current === emoji}
          onClick={() => onPick(emoji)}>{emoji}</button>
      ))}
      {!more && (
        <button type="button" className="k-react-pick is-more" aria-label="More reactions" onClick={() => setMore(true)}>
          <Plus size={18} />
        </button>
      )}
    </div>
  );
}

/** Reaction chips under a bubble. Tapping one adds that reaction, or removes yours. */
export function ReactionChips({ reactions, nameOf, onToggle }: {
  reactions?: Record<string, string>; nameOf: (who: string) => string; onToggle?: (emoji: string) => void;
}) {
  const chips = summarizeReactions(reactions);
  if (!chips.length) return null;
  return (
    <div className="k-reactions">
      {chips.map((c) => {
        const names = c.who.map(nameOf).join(', ');
        return (
          <button key={c.emoji} type="button" className={`k-reaction${c.mine ? ' is-mine' : ''}`} disabled={!onToggle}
            title={names} aria-label={`${c.emoji} ${names}${c.mine ? ' — tap to remove yours' : ''}`}
            onClick={() => onToggle?.(c.emoji)}>
            <span className="k-reaction-emoji">{c.emoji}</span>{c.count > 1 && <span className="k-reaction-count">{c.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Gestures ─────────────────────────────────────────────────────── */

/**
 * Swipe right to reply and double-tap to react, on touch screens. A drag is
 * only claimed once it is clearly horizontal, so the thread still scrolls;
 * touches that start on links, buttons, players or scrollable blocks (code,
 * tables) are left alone.
 */
export function useBubbleGestures({ swipe, doubleTap, onSwipe, onDoubleTap }: {
  swipe: boolean; doubleTap: boolean; onSwipe: () => void; onDoubleTap: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const drag = useRef<{ x: number; y: number; at: number; mode: 'pending' | 'scroll' | 'swipe'; moved: boolean; buzzed: boolean } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const set = (v: number) => { offsetRef.current = v; setOffset(v); };

  const handlers = {
    onTouchStart: (e: ReactTouchEvent) => {
      const target = e.target as Element;
      if (e.touches.length !== 1 || target.closest('a, button, input, textarea, audio, video, .k-voice, .k-md-pre, .k-md-table')) {
        drag.current = null;
        return;
      }
      const t = e.touches[0];
      drag.current = { x: t.clientX, y: t.clientY, at: Date.now(), mode: 'pending', moved: false, buzzed: false };
    },
    onTouchMove: (e: ReactTouchEvent) => {
      const d = drag.current;
      if (!d) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x, dy = t.clientY - d.y;
      if (Math.hypot(dx, dy) > 8) d.moved = true;
      if (d.mode === 'pending') {
        const kind = classifyDrag(dx, dy);
        d.mode = kind === 'swipe' && !swipe ? 'scroll' : kind;
      }
      if (d.mode !== 'swipe') return;
      const next = swipeOffset(dx);
      set(next);
      if (next >= SWIPE.trigger && !d.buzzed) { d.buzzed = true; navigator.vibrate?.(10); }
    },
    onTouchEnd: (e: ReactTouchEvent) => {
      const d = drag.current;
      drag.current = null;
      if (d?.mode === 'swipe') {
        if (offsetRef.current >= SWIPE.trigger) onSwipe();
        set(0);
        return;
      }
      if (!d || d.moved || Date.now() - d.at > 300 || !doubleTap) return;
      const t = e.changedTouches[0];
      const prev = lastTap.current;
      if (prev && Date.now() - prev.at < 320 && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 32) {
        lastTap.current = null;
        e.preventDefault(); // no zoom, no trailing click
        onDoubleTap();
      } else {
        lastTap.current = { at: Date.now(), x: t.clientX, y: t.clientY };
      }
    },
    onTouchCancel: () => { drag.current = null; set(0); },
  };
  return { offset, handlers };
}

/* ── Composer formatting bar ──────────────────────────────────────── */

const FORMAT_BUTTONS: { kind: FormatKind; label: string; glyph: string; className?: string }[] = [
  { kind: 'bold', label: 'Bold', glyph: 'B', className: 'is-bold' },
  { kind: 'italic', label: 'Italic', glyph: 'I', className: 'is-italic' },
  { kind: 'strike', label: 'Strikethrough', glyph: 'S', className: 'is-strike' },
  { kind: 'code', label: 'Code', glyph: '</>', className: 'is-code' },
  { kind: 'quote', label: 'Quote', glyph: '❝' },
  { kind: 'list', label: 'List', glyph: '•' },
];

/** Shown above the input while text is selected. Buttons never take focus, so the selection survives. */
export function FormatBar({ onFormat }: { onFormat: (kind: FormatKind) => void }) {
  return (
    <div className="k-format-bar" role="toolbar" aria-label="Formatting">
      {FORMAT_BUTTONS.map((b) => (
        <button key={b.kind} type="button" className={`k-format-btn ${b.className ?? ''}`} aria-label={b.label} title={b.label}
          onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.preventDefault()}
          onClick={() => onFormat(b.kind)}>{b.glyph}</button>
      ))}
    </div>
  );
}

/* ── Delete ───────────────────────────────────────────────────────── */

export function DeleteSheet({ forEveryone, everyoneUnavailable, onDelete, onClose }: {
  /** Offer "Delete for everyone" (your own message). */
  forEveryone: boolean;
  /** Why it can't be deleted for everyone, when it's yours but their Kant can't do it. */
  everyoneUnavailable?: string;
  onDelete: (forEveryone: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} label="Delete message">
      <div className="k-sheet-hero" style={{ paddingTop: 22 }}>
        <h2 className="k-title-2">Delete message?</h2>
        <p>
          {forEveryone
            ? 'Delete for everyone removes it from every device in this chat. Anyone could already have read it.'
            : everyoneUnavailable ?? 'It will be removed from this device only.'}
        </p>
      </div>
      <div className="k-sheet-foot">
        {forEveryone && (
          <button type="button" className="k-btn k-btn-block k-btn-danger" onClick={() => { onDelete(true); onClose(); }}>Delete for everyone</button>
        )}
        <button type="button" className={`k-btn k-btn-block ${forEveryone ? 'k-btn-secondary is-danger-text' : 'k-btn-danger'}`}
          onClick={() => { onDelete(false); onClose(); }}>Delete for me</button>
        <button type="button" className="k-btn k-btn-block k-btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
