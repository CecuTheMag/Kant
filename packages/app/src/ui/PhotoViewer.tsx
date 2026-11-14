/**
 * A photo, full screen. Tap to hide the bars, double-tap to zoom, drag down to
 * put it away. Save and "Open with…" work on the decrypted copy that is
 * already in memory; nothing is fetched.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './core/store';
import type { MessageAttachment } from './core/types';
import { Alert, Check, Close, Download, Share, Spinner } from './icons';
import { useBackHandler, useToast } from './parts';
import { canOpenExternally, openExternally } from '../lib/fileActions';
import { displayFileName } from './preview/sanitize';
import { tap } from '../lib/haptics';

export interface PhotoRef { src: string; attachment: MessageAttachment; who: string; when: string }

const ZOOM = 2.5;
const DISMISS_DISTANCE = 120;

export function PhotoViewer({ photo, onClose }: { photo: PhotoRef; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [bars, setBars] = useState(true);
  const [busy, setBusy] = useState<'save' | 'open' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBackHandler(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Gestures. Native listeners so a drag can stop the page from scrolling.
  useEffect(() => {
    const root = rootRef.current;
    const img = imgRef.current;
    if (!root || !img) return;
    let zoom = { scale: 1, x: 0, y: 0 };
    let start: { x: number; y: number; zx: number; zy: number } | null = null;
    let mode: 'none' | 'dismiss' | 'pan' = 'none';
    let dy = 0;
    let moved = false;
    let lastTap = 0;
    let tapTimer = 0;

    const place = (animate: boolean) => {
      img.style.transition = animate ? 'transform 0.3s var(--spring)' : 'none';
      img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    };
    const clamp = () => {
      const maxX = (img.offsetWidth * (zoom.scale - 1)) / 2;
      const maxY = (img.offsetHeight * (zoom.scale - 1)) / 2;
      zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
      zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
    };
    const toggleZoom = (px: number, py: number) => {
      if (zoom.scale > 1) zoom = { scale: 1, x: 0, y: 0 };
      else {
        // Keep the point under the finger where it is.
        const r = img.getBoundingClientRect();
        zoom = { scale: ZOOM, x: (r.left + r.width / 2 - px) * (ZOOM - 1), y: (r.top + r.height / 2 - py) * (ZOOM - 1) };
        clamp();
      }
      place(true);
    };

    const onStart = (e: TouchEvent) => {
      if ((e.target as Element).closest('button')) { start = null; return; }
      if (e.touches.length !== 1) { start = null; return; }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, zx: zoom.x, zy: zoom.y };
      mode = 'none'; dy = 0; moved = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const mx = e.touches[0].clientX - start.x;
      const my = e.touches[0].clientY - start.y;
      if (Math.hypot(mx, my) > 8) moved = true;
      if (mode === 'none' && moved) mode = zoom.scale > 1 ? 'pan' : Math.abs(my) > Math.abs(mx) ? 'dismiss' : 'none';
      if (e.cancelable) e.preventDefault();
      if (mode === 'pan') {
        zoom.x = start.zx + mx; zoom.y = start.zy + my;
        clamp();
        place(false);
      } else if (mode === 'dismiss') {
        dy = my;
        const progress = Math.min(1, Math.abs(dy) / 400);
        img.style.transition = 'none';
        img.style.transform = `translateY(${dy}px) scale(${1 - progress * 0.15})`;
        root.style.setProperty('--dim', String(1 - progress));
        root.classList.add('is-dragging');
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const was = mode;
      const point = e.changedTouches[0];
      start = null; mode = 'none';
      if (was === 'dismiss') {
        if (Math.abs(dy) > DISMISS_DISTANCE) { tap(); closeRef.current(); return; }
        root.classList.remove('is-dragging');
        root.style.removeProperty('--dim');
        place(true);
        return;
      }
      if (moved) return;
      // A tap: twice quickly zooms, once shows or hides the bars.
      e.preventDefault();
      window.clearTimeout(tapTimer);
      if (e.timeStamp - lastTap < 300) { lastTap = 0; toggleZoom(point.clientX, point.clientY); return; }
      lastTap = e.timeStamp;
      tapTimer = window.setTimeout(() => setBars((v) => !v), 300);
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: false });
    root.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(tapTimer);
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const name = displayFileName(photo.attachment.name) || 'Photo';
  const save = async () => {
    setBusy('save');
    try {
      const ok = await store.downloadAttachment(photo.attachment);
      toast(ok ? 'Saved' : 'Couldn’t save the photo', ok ? <Check size={18} /> : <Alert size={18} />);
    } finally { setBusy(null); }
  };
  const openWith = async () => {
    setBusy('open');
    try {
      const bytes = new Uint8Array(await (await fetch(photo.src)).arrayBuffer());
      const result = await openExternally(name, photo.attachment.mime, bytes);
      if (result !== 'opened') toast(result === 'no-app' ? 'No app can open this photo' : 'Couldn’t open the photo', <Alert size={18} />);
    } catch {
      toast('Couldn’t open the photo', <Alert size={18} />);
    } finally { setBusy(null); }
  };

  return createPortal(
    <div ref={rootRef} className={`k-photo${bars ? '' : ' is-bare'}`} role="dialog" aria-modal="true" aria-label={`Photo from ${photo.who}`}
      // Mouse: a click beside the photo closes it. Touch taps are handled above.
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).classList.contains('k-photo-stage')) onClose(); }}>
      <div className="k-photo-stage">
        <img ref={imgRef} src={photo.src} alt={name} draggable={false} />
      </div>
      <header className="k-photo-bar is-top">
        <button type="button" className="k-icon-btn" onClick={onClose} aria-label="Close"><Close size={24} /></button>
        <div className="k-photo-title"><b>{photo.who}</b><span>{photo.when}</span></div>
        <span className="k-photo-spacer" />
      </header>
      <footer className="k-photo-bar is-bottom">
        {canOpenExternally() && (
          <button type="button" className="k-photo-action" onClick={() => { void openWith(); }} disabled={!!busy}>
            {busy === 'open' ? <Spinner size={22} /> : <Share size={22} />}Open with…
          </button>
        )}
        <button type="button" className="k-photo-action" onClick={() => { void save(); }} disabled={!!busy}>
          {busy === 'save' ? <Spinner size={22} /> : <Download size={22} />}Save
        </button>
      </footer>
    </div>,
    document.body,
  );
}
