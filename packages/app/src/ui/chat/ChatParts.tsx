/**
 * Pieces of the conversation view: formatted message text, reactions (the bar
 * in the long-press menu and the chips under a bubble), the composer's
 * formatting bar, the swipe/double-tap gestures and the delete sheet.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { parseMarkdown } from '../preview/markdown';
import { Markdown } from '../preview/MarkdownView';
import { Sheet, useBackHandler } from '../parts';
import type { MenuItem } from '../parts';
import { Camera, Doc, DocText, Photo, Plus, TableIcon } from '../icons';
import { select } from '../../lib/haptics';
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
      if (next >= SWIPE.trigger && !d.buzzed) { d.buzzed = true; select(); }
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

/* ── Focused message (long-press on a phone) ──────────────────────── */

const FOCUS_GAP = 8;
const FOCUS_EDGE = 12;

/**
 * The pressed message lifts out of a blurred chat, with reactions above it and
 * its actions below — nothing covers the message being acted on.
 */
export function MessageFocus({ source, out, header, items, onClose }: {
  /** The bubble that was pressed; a copy of it is shown in focus. */
  source: HTMLElement; out: boolean; header?: ReactNode; items: MenuItem[]; onClose: () => void;
}) {
  const rect = useMemo(() => source.getBoundingClientRect(), [source]);
  const holder = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ bar: header ? 52 : 0, list: items.length * 45 + 12 });
  useBackHandler(onClose);

  useLayoutEffect(() => {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.classList.remove('is-pressed');
    copy.style.animation = 'none';
    holder.current?.appendChild(copy);
    source.style.visibility = 'hidden';
    return () => { source.style.visibility = ''; copy.remove(); };
  }, [source]);

  // The reaction bar can grow ("more"); keep everything on screen when it does.
  useLayoutEffect(() => {
    const measure = () => setSizes((prev) => {
      const next = { bar: barRef.current?.offsetHeight ?? 0, list: listRef.current?.offsetHeight ?? 0 };
      return next.bar === prev.bar && next.list === prev.list ? prev : next;
    });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (barRef.current) observer?.observe(barRef.current);
    if (listRef.current) observer?.observe(listRef.current);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onClose); };
  }, [onClose]);

  const vh = window.innerHeight, vw = window.innerWidth;
  const above = sizes.bar ? sizes.bar + FOCUS_GAP : 0;
  const below = sizes.list ? sizes.list + FOCUS_GAP : 0;
  const minTop = FOCUS_EDGE + above;
  const room = Math.max(80, vh - FOCUS_EDGE - below - minTop);
  const height = Math.min(rect.height, room);
  const top = Math.max(minTop, Math.min(rect.top, vh - FOCUS_EDGE - below - height));
  const side = out
    ? { right: Math.max(FOCUS_EDGE, vw - rect.right) }
    : { left: Math.max(FOCUS_EDGE, rect.left) };

  return createPortal(
    <div className="k-focus" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      {header && (
        <div ref={barRef} className="k-menu has-header k-focus-bar" style={{ bottom: vh - top + FOCUS_GAP, ...side }}
          onClick={(e) => e.stopPropagation()}>{header}</div>
      )}
      <div ref={holder} className={`k-msg ${out ? 'out' : 'in'} k-focus-msg`}
        style={{ top, left: rect.left, width: rect.width, maxHeight: height, '--from': `${rect.top - top}px` } as React.CSSProperties} />
      {items.length > 0 && (
        <div ref={listRef} className="k-menu k-focus-actions" role="menu" style={{ top: top + height + FOCUS_GAP, ...side }}
          onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'is-danger' : ''}
              onClick={() => { onClose(); it.onSelect(); }}>
              {it.label}
              {it.icon}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/* ── Attach tray ──────────────────────────────────────────────────── */

export type AttachKind = 'photo' | 'camera' | 'file' | 'table' | 'document';

const ATTACH: { kind: AttachKind; label: string; tone: string; icon: ReactNode }[] = [
  { kind: 'photo', label: 'Photos', tone: 'blue', icon: <Photo size={26} /> },
  { kind: 'camera', label: 'Camera', tone: 'gray', icon: <Camera size={26} /> },
  { kind: 'file', label: 'File', tone: 'indigo', icon: <Doc size={26} /> },
  { kind: 'table', label: 'Table', tone: 'green', icon: <TableIcon size={26} /> },
  { kind: 'document', label: 'Document', tone: 'orange', icon: <DocText size={26} /> },
];

/** What the "+" opens: everything that can go into a message, as one row of tiles. */
export function AttachTray({ onPick, onClose }: { onPick: (kind: AttachKind) => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} label="Attach">
      <div className="k-attach-tray" role="menu">
        {ATTACH.map((a) => (
          <button key={a.kind} type="button" role="menuitem" aria-label={a.label} onClick={() => { onPick(a.kind); onClose(); }}>
            <span className={`k-attach-tile ${a.tone}`}>{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
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
