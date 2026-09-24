/**
 * Shared building blocks. Every screen is composed from these so spacing,
 * motion and hit targets stay identical across the app.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hueFor, initials } from './lib';
import { ChevronRight, People, Person } from './icons';

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

/* ── Sheets ───────────────────────────────────────────────────────── */

const SheetDepth = createContext(0);

/**
 * Bottom sheet on phones, centred card on larger screens. Escape and a tap on
 * the backdrop close it; focus moves inside on open and back on close.
 */
export function Sheet({ onClose, children, label, tall }: {
  onClose: () => void; children: ReactNode; label: string; tall?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const depth = useContext(SheetDepth);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea');
    if (!window.matchMedia('(hover: none)').matches) first?.focus();
    // Only the top-most sheet reacts to Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const sheets = document.querySelectorAll('.k-sheet');
      if (sheets[sheets.length - 1] === ref.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return createPortal(
    <SheetDepth.Provider value={depth + 1}>
      <div className="k-backdrop" style={{ zIndex: 40 + depth * 2 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="k-switch" onClick={() => onChange(!checked)} />;
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

export function Menu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const openedAt = useRef(Date.now());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)),
    });
  }, [at]);
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
      <div ref={ref} className="k-menu" role="menu" style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
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
