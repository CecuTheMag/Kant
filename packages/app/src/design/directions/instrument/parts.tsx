import { useEffect, useRef, useState } from 'react';
import type { Contact, NodeStatus, RouteHop, TrustState } from '../../core/types';
import { shortKey } from '../../core/fingerprint';
import { useStore } from '../../core/store';
import { STATUS_COPY } from '../../core/mock';
import { Shield, ShieldAlert, ShieldCheck, Route } from '../../components/icons';

/* ------------------------------------------------------------------ *
 * Identity glyph — a 5×5 mirrored matrix derived from the public key.
 *
 * Purpose is pre-attentive recognition: you notice a wrong glyph before you've consciously
 * read anything. Raw hex offers no such channel, which is a large part of why fingerprint
 * comparison fails in practice.
 * ------------------------------------------------------------------ */

export function Glyph({ hex, size = 30 }: { hex: string; size?: number }) {
  /* Derived cryptographically in the store and cached — the glyph is a security signal, so it
     must not be cheap to grind a collision for. Until it's derived we render the empty frame
     rather than a wrong mark. */
  const g = useStore().identity(hex);
  const cell = Math.floor((size - 4) / 5);
  if (!g) return <div className="glyph" style={{ width: size, height: size }} aria-hidden />;
  return (
    <div className="glyph" style={{ width: size, height: size }} aria-hidden>
      {g.cells.map((on, i) => (
        <div
          key={i}
          className="glyph-cell"
          style={{
            width: cell,
            height: cell,
            background: on
              ? `hsl(${i % 2 ? g.hueAlt : g.hue} 62% 62%)`
              : 'transparent',
          }}
        />
      ))}
    </div>
  );
}

export function Avatar({ contact, size = 30 }: { contact: Contact; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      <Glyph hex={contact.publicKeyHex} size={size} />
      <span
        className={`avatar-dot ${contact.online ? 'dot-online' : 'dot-offline'}`}
        role="img"
        aria-label={contact.online ? 'Online' : 'Offline'}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Trust badge
 *
 * `unverified` is deliberately quiet — no colour, no icon fill. It is where every contact
 * starts, and painting the default state as a warning is how you train people to ignore
 * warnings. The loud styling is reserved for `changed`.
 * ------------------------------------------------------------------ */

export const TRUST_COPY: Record<TrustState, { label: string; long: string }> = {
  verified: { label: 'Verified', long: 'You compared fingerprints with this person in the real world.' },
  unverified: { label: 'Not verified', long: 'You have not compared fingerprints yet. Messages are still encrypted.' },
  changed: { label: 'Key changed', long: 'This key is different from the one you verified. Someone may be impersonating them.' },
};

export function TrustBadge({ trust, showLabel = true }: { trust: TrustState; showLabel?: boolean }) {
  const cls = trust === 'verified' ? 'trust-verified' : trust === 'changed' ? 'trust-changed' : 'trust-unverified';
  const Icon = trust === 'verified' ? ShieldCheck : trust === 'changed' ? ShieldAlert : Shield;
  return (
    <span className={`trust ${cls}`} title={TRUST_COPY[trust].long}>
      <Icon size={12} strokeWidth={2.2} />
      {showLabel && TRUST_COPY[trust].label}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Route spine — the signature element.
 *
 * Kant has no server: a message physically hops through a relay and, with onion routing on,
 * through other people's nodes. Every other messenger hides that. Here it is the most
 * characteristic object on screen — a live transit diagram with per-hop latency.
 * ------------------------------------------------------------------ */

export function RouteSpine({
  hops,
  status,
  peerLabel,
}: {
  hops: RouteHop[];
  status: NodeStatus;
  /** The far end of the path is whoever you're talking to — not a fixed name. */
  peerLabel?: string;
}) {
  const offline = status === 'offline' || status === 'error' || hops.length === 0;
  const path = peerLabel
    ? hops.map((h) => (h.kind === 'peer' ? { ...h, label: peerLabel } : h))
    : hops;

  if (offline) {
    return (
      <div className="spine is-offline">
        <div className="spine-node">
          <span className="spine-dot self" />
          <span className="spine-label">you</span>
        </div>
        <div className="spine-link" />
        <div className="spine-node">
          <span className="spine-dot" />
          <span className="spine-label" style={{ color: 'var(--fg-disabled)' }}>
            {status === 'error' ? 'relay unreachable' : 'no route'}
          </span>
        </div>
        <div className="spine-mode">
          <span className="t-label" style={{ color: 'var(--net-error)' }}>
            {status === 'error' ? 'error' : 'offline'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="spine">
      {path.map((h, i) => (
        <div key={`${h.label}-${i}`} style={{ display: 'contents' }}>
          {i > 0 && <div className="spine-link" />}
          <div className="spine-node">
            <span className={`spine-dot ${h.kind}`} />
            <span className="spine-label">{h.label}</span>
            {h.ms !== undefined && <span className="spine-ms">{h.ms}ms</span>}
          </div>
        </div>
      ))}
      <div className="spine-mode">
        <Route size={12} color="var(--fg-tertiary)" />
        <span className="t-label" style={{ color: 'var(--fg-secondary)' }}>
          {status}
        </span>
        <span className="spine-ms">
          {path.reduce((a, h) => a + (h.ms ?? 0), 0)}ms total
        </span>
      </div>
    </div>
  );
}

/** Per-message provenance — a miniature of the spine, so you can see at a glance that this
 *  particular message went the long way round. */
export function SpineMini({ hops }: { hops?: RouteHop[] }) {
  if (!hops?.length) return null;
  return (
    <span className="spine-mini" title={hops.map((h) => h.label).join(' → ')}>
      {hops.map((h, i) => (
        <i key={i} className={h.kind} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Status chip + popover
 *
 * Replaces the dead grey "Offline" text. Click for the full route, the relay URL, and what
 * the current mode actually means for your privacy — copy that currently only exists buried
 * in Settings.
 * ------------------------------------------------------------------ */

export function StatusChip({
  status,
  hops,
  relay,
  onConnect,
}: {
  status: NodeStatus;
  hops: RouteHop[];
  relay: string;
  onConnect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const copy = STATUS_COPY[status];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="status"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`status-led led-${status}`} />
        {copy.label}
      </button>

      {open && (
        <div className="popover" style={{ top: 32, left: 0 }} role="dialog" aria-label="Connection detail">
          <div className="t-label" style={{ marginBottom: 8 }}>Connection</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-secondary)', lineHeight: 1.55, marginBottom: 14 }}>
            {copy.detail}
          </div>

          {hops.length > 0 && (
            <>
              <div className="t-label" style={{ marginBottom: 8 }}>Path</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {hops.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`spine-dot ${h.kind}`} />
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-secondary)' }}>{h.label}</span>
                    {h.ms !== undefined && (
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-disabled)', marginLeft: 'auto' }}>
                        {h.ms}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="t-label" style={{ marginBottom: 6 }}>Relay</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--fg-tertiary)', wordBreak: 'break-all', marginBottom: 14 }}>
            {relay || 'Not configured'}
          </div>

          {(status === 'offline' || status === 'error') && onConnect && (
            <button className="btn btn-primary btn-block" onClick={onConnect}>
              Connect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Fingerprint
 * ------------------------------------------------------------------ */

export function Fingerprint({
  words,
  compare,
}: {
  /** The eight words to show. The caller decides whether these are the symmetric ceremony
   *  fingerprint (comparing a conversation) or a single key rendered for sharing. */
  words: string[];
  /** When present, each word is marked match/diff against this list. */
  compare?: string[] | null;
}) {
  const other = compare ?? null;
  return (
    <div className="fp">
      {words.map((w, i) => {
        const state = other ? (other[i] === w ? 'match' : 'diff') : '';
        return (
          <div key={i} className={`fp-word ${state}`}>
            <span className="fp-index">{String(i + 1).padStart(2, '0')}</span>
            {w}
          </div>
        );
      })}
    </div>
  );
}

export function ShortKey({ hex }: { hex: string }) {
  return <span className="mono" style={{ fontSize: 11, color: 'var(--fg-tertiary)' }}>{shortKey(hex)}</span>;
}
