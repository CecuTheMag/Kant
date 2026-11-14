/**
 * Shared building blocks. Every screen is composed from these so spacing,
 * motion and hit targets stay identical across the app.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hueFor, initials } from './lib';
import { ChevronRight, People, Person } from './icons';
import { pushBack } from './core/backStack';
import { coverBars } from '../lib/systemBars';
import { select, tap } from '../lib/haptics';

/* ── Avatars ──────────────────────────────────────────────────────── */

export function Avatar({ name, seed, size = 44, online, group }: {
  name: string; seed: string; size?: number; online?: boolean; group?: boolean;
}) {
  const text = group ? '' : initials(name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38), '--h': hueFor(seed) } as CSSProperties;
  return (
    <span className={`k-avatar${!text && !group ? ' is-plain' : ''}`} style={style} aria-hidden="true">
      {group ? <People size={Math.round(size * 0.5)} stroke={2} /> : text || <Person size={Math.round(size * 0.52)} stroke={2} />}
      {online && <span className="k-avatar-dot" />}
    </span>
  );
}

/* ── Back button ──────────────────────────────────────────────────── */

/** While mounted (and `active`), the Android back button runs `onBack` instead of leaving the screen. */
export function useBackHandler(onBack: () => void, active = true) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => (active ? pushBack(() => ref.current()) : undefined), [active]);
}

/* ── Sheets ───────────────────────────────────────────────────────── */

const SheetDepth = createContext(0);
const PHONE = '(max-width: 767px)';
/** Drag a sheet at least this far (px), or flick it, to dismiss it. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.6;

/**
 * Leave a non-interactive copy of a closing overlay behind for the length of
 * its exit animation. Whoever closes a sheet — its own buttons, the backdrop,
 * a swipe, the back button — it slides away instead of vanishing.
 */
function animateOut(node: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.classList.add('is-closing');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.querySelector('.k-sheet')?.classList.add('is-closing');
  document.body.appendChild(ghost);
  window.setTimeout(() => ghost.remove(), 320);
}

/**
 * Bottom sheet on phones, centred card on larger screens. Escape, the back
 * button, a tap on the backdrop and (on phones) a swipe down close it; focus
 * moves inside on open and back on close. On phones the screen behind steps
 * back while a sheet is up.
 */
export function Sheet({ onClose, children, label, tall }: {
  onClose: () => void; children: ReactNode; label: string; tall?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const depth = useContext(SheetDepth);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBackHandler(() => closeRef.current());

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]')
      ?? ref.current?.querySelector<HTMLElement>('input, textarea');
    if (!window.matchMedia('(hover: none)').matches) first?.focus();
    // Only the top-most sheet reacts to Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const sheets = document.querySelectorAll('.k-sheet:not(.is-closing)');
      if (sheets[sheets.length - 1] === ref.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);

  // Exit animation, and the screen behind stepping back (first sheet on a phone only).
  useLayoutEffect(() => {
    const node = backdropRef.current;
    const stacked = depth === 0 && window.matchMedia(PHONE).matches;
    if (stacked) { document.body.classList.add('k-sheet-open'); coverBars(true); }
    return () => {
      if (stacked) { coverBars(false); const others = Array.from(document.querySelectorAll('.k-backdrop[data-depth="0"]:not(.is-closing)')).some((el) => el !== node); if (!others) document.body.classList.remove('k-sheet-open'); }
      if (node) animateOut(node);
    };
  }, [depth]);

  // Swipe down to dismiss. Native listeners: React's touch handlers are passive.
  useEffect(() => {
    const sheet = ref.current;
    const backdrop = backdropRef.current;
    if (!sheet || !backdrop) return;
    let start: { x: number; y: number; t: number } | null = null;
    let dragging = false;
    let dy = 0;

    const settle = () => {
      sheet.style.transition = 'transform 0.35s var(--spring)';
      sheet.style.transform = '';
      backdrop.style.removeProperty('--dim');
      window.setTimeout(() => { sheet.style.transition = ''; }, 360);
    };
    const onStart = (e: TouchEvent) => {
      start = null; dragging = false; dy = 0;
      if (e.touches.length !== 1 || !window.matchMedia(PHONE).matches) return;
      const target = e.target as HTMLElement;
      const handle = !!target.closest('.k-sheet-grabber, .k-sheet-head');
      if (!handle) {
        if (target.closest('input, textarea, [contenteditable], .k-wave, .k-scanner, .k-editor-grid')) return;
        // Content that is scrolled down scrolls first.
        for (let el: HTMLElement | null = target; el && el !== sheet; el = el.parentElement) if (el.scrollTop > 0) return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const mx = e.touches[0].clientX - start.x;
      const my = e.touches[0].clientY - start.y;
      if (!dragging) {
        if (my < -6 || Math.abs(mx) > 10) { start = null; return; }
        if (my < 6 || my < Math.abs(mx)) return;
        dragging = true;
        sheet.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, my);
      sheet.style.transform = `translateY(${dy}px)`;
      backdrop.style.setProperty('--dim', String(Math.max(0, 1 - dy / sheet.offsetHeight)));
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || !dragging) { start = null; return; }
      const velocity = dy / Math.max(1, e.timeStamp - start.t);
      start = null; dragging = false;
      if (dy > DISMISS_DISTANCE || (dy > 30 && velocity > DISMISS_VELOCITY)) {
        // The exit animation continues from where the finger let go.
        sheet.style.setProperty('--drag', `${dy}px`);
        tap();
        closeRef.current();
        // Still here a moment later? The owner declined to close (unsaved work).
        window.setTimeout(() => { if (sheet.isConnected) settle(); }, 60);
      } else settle();
    };
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return createPortal(
    <SheetDepth.Provider value={depth + 1}>
      <div ref={backdropRef} className="k-backdrop" data-depth={depth} style={{ zIndex: 40 + depth * 2 }}
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className={`k-sheet${tall ? ' is-tall' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
          <div className="k-sheet-grabber" />
          {children}
        </div>
      </div>
    </SheetDepth.Provider>,
    document.body,
  );
}

export function SheetHead({ title, left, right }: { title?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="k-sheet-head">
      <div>{left}</div>
      <div className="k-sheet-title">{title}</div>
      <div>{right}</div>
    </header>
  );
}

/** The top of a sheet that does one job: a symbol, what it is, and one or two sentences. */
export function SheetHero({ icon, tone, title, children }: {
  icon: ReactNode; tone?: 'ok' | 'danger'; title: string; children?: ReactNode;
}) {
  return (
    <div className="k-sheet-hero">
      <div className={`k-hero-symbol is-compact${tone ? ` is-${tone}` : ''}`} aria-hidden="true">{icon}</div>
      <h2 className="k-title-2">{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/* ── Grouped lists ────────────────────────────────────────────────── */

export function Section({ title, foot, children, icons }: {
  title?: ReactNode; foot?: ReactNode; children: ReactNode; icons?: boolean;
}) {
  return (
    <section className="k-section">
      {title && <h2 className="k-section-title">{title}</h2>}
      <div className={`k-group${icons ? ' has-icons' : ''}`}>{children}</div>
      {foot && <p className="k-section-foot">{foot}</p>}
    </section>
  );
}

export function Cell({ icon, iconTone, label, sub, value, onClick, chevron, tone, children, href, selected }: {
  icon?: ReactNode; iconTone?: string; label?: ReactNode; sub?: ReactNode; value?: ReactNode;
  onClick?: () => void; chevron?: boolean; tone?: 'action' | 'danger' | 'center-action' | 'center-danger';
  children?: ReactNode; href?: string; selected?: boolean;
}) {
  const cls = `k-cell${tone === 'action' ? ' is-action' : ''}${tone === 'danger' ? ' is-danger' : ''}${tone?.startsWith('center') ? ' is-center' : ''}${tone === 'center-action' ? ' is-action' : ''}${tone === 'center-danger' ? ' is-danger' : ''}${selected ? ' is-selected' : ''}`;
  const inner = (
    <>
      {icon && <span className={`k-cell-icon ${iconTone ?? ''}`}>{icon}</span>}
      {(label || sub) && (
        <span className="k-cell-body">
          {label && <span className="k-cell-label">{label}</span>}
          {sub && <span className="k-cell-sub">{sub}</span>}
        </span>
      )}
      {children}
      {value !== undefined && <span className="k-cell-value">{value}</span>}
      {chevron && <ChevronRight className="k-cell-chev" />}
    </>
  );
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer">{inner}</a>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="k-switch" disabled={disabled} onClick={() => { select(); onChange(!checked); }} />;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="k-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ── Context menu ─────────────────────────────────────────────────── */

export interface MenuItem { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }

export function Menu({ at, items, onClose, header }: {
  at: { x: number; y: number }; items: MenuItem[]; onClose: () => void;
  /** Content above the items (e.g. the reaction bar). */
  header?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const openedAt = useRef(Date.now());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      setPos({
        x: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)),
      });
    };
    place();
    // The header can grow (more reactions); keep the menu on screen.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [at]);
  useBackHandler(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div className="k-menu-layer" onMouseDown={onClose} onTouchStart={onClose}
      onContextMenu={(e) => { e.preventDefault(); if (Date.now() - openedAt.current > 700) onClose(); }}>
      <div ref={ref} className={`k-menu${header ? ' has-header' : ''}`} role="menu" style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
        {header}
        {items.map((it) => (
          <button key={it.label} role="menuitem" className={it.danger ? 'is-danger' : ''}
            onClick={() => { onClose(); it.onSelect(); }}>
            {it.label}
            {it.icon}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ── Toasts ───────────────────────────────────────────────────────── */

const ToastCtx = createContext<(msg: string, icon?: ReactNode) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; msg: string; icon?: ReactNode } | null>(null);
  const show = useCallback((msg: string, icon?: ReactNode) => setToast({ id: Date.now(), msg, icon }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && createPortal(
        <div key={toast.id} className="k-toast" role="status">{toast.icon}{toast.msg}</div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ── Confirm sheet ────────────────────────────────────────────────── */

export function Confirm({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} label={title}>
      <div className="k-sheet-hero" style={{ paddingTop: 22 }}>
        <h2 className="k-title-2">{title}</h2>
        <p>{message}</p>
      </div>
      <div className="k-sheet-foot">
        <button type="button" className={`k-btn k-btn-block ${danger ? 'k-btn-danger' : 'k-btn-primary'}`}
          onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        <button type="button" className="k-btn k-btn-block k-btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
