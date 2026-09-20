/**
 * Completion modals for the real-app integration (2026-08-17).
 *
 * The rev-2 prototype's "Add contact" buttons were stubs and the design had no
 * group-creation UI. These two modals complete those affordances using ONLY the
 * design's existing classes (.overlay/.modal/.field/.input-wrap/.btn) so the look
 * is indistinguishable from the direction's own components. They call the real
 * store (addContact → IDB via useKant) and the real group API (createNewGroup).
 */

import { useState } from 'react';
import { useStore } from '../core/store';
import { Plus, X, Users } from './icons';

/** Instrument-styled modal shell (matches .modal/.overlay used by VerifySheet). */
function Sheet({ title, caption, onClose, children, footer }: {
  title: string; caption: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <Users size={17} color="var(--fg-secondary)" />
          <div style={{ flex: 1 }}>
            <div className="t-heading">{title}</div>
            <div className="t-caption">{caption}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Add a contact by public key (+ optional nickname + optional circuit address). */
export function AddContactModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [hex, setHex] = useState('');
  const [nick, setNick] = useState('');
  const [addr, setAddr] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const k = hex.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(k)) { setErr('A public key is 64 hexadecimal characters (0-9, a-f).'); return; }
    setErr(null);
    store.addContact(k, nick.trim(), addr.trim());
    onClose();
  };

  return (
    <Sheet
      title="Add contact"
      caption="Paste their public key. You can compare fingerprints later to confirm it is really them."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!hex.trim()}>Add contact</button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="ac-hex">Public key</label>
        <div className={`input-wrap${err ? ' is-error' : ''}`}>
          <input id="ac-hex" className="input mono" value={hex}
            onChange={(e) => setHex(e.target.value)} placeholder="64 hex characters…"
            spellCheck={false} autoFocus />
        </div>
        {err && <div className="field-error">{err}</div>}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label className="field-label" htmlFor="ac-nick">Nickname (optional)</label>
        <div className="input-wrap">
          <input id="ac-nick" className="input" value={nick}
            onChange={(e) => setNick(e.target.value)} placeholder="e.g. Mara" />
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label className="field-label" htmlFor="ac-addr">Circuit address (optional)</label>
        <div className="input-wrap">
          <input id="ac-addr" className="input mono" value={addr}
            onChange={(e) => setAddr(e.target.value)} placeholder="/dns4/…/p2p-circuit/p2p/…"
            spellCheck={false} />
        </div>
        <span className="field-hint">Paste once — Kant keeps it updated automatically. Needed when their relay is different from yours.</span>
      </div>
      <p className="modal-note">
        If they are online on your relay, the app finds their address automatically.
      </p>
    </Sheet>
  );
}

/** Create a group from existing contacts (real group key distribution). */
export function NewGroupModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const contacts = store.state.contacts.filter((c) => c.publicKeyHex !== store.state.meHex);
  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = () => {
    if (!name.trim()) { setErr('Give the group a name.'); return; }
    if (picked.size === 0) { setErr('Pick at least one member (you are always included).'); return; }
    setErr(null);
    store.createGroup?.(name.trim(), [...picked]);
    onClose();
  };

  return (
    <Sheet
      title="New group"
      caption="The group key is distributed to each member through their own session."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim() || picked.size === 0}>
            <Plus size={13} /> Create group
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="ng-name">Group name</label>
        <div className="input-wrap">
          <input id="ng-name" className="input" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="e.g. Roadtrip" autoFocus />
        </div>
        {err && <div className="field-error" style={{ marginTop: 6 }}>{err}</div>}
      </div>
      <div className="t-label" style={{ margin: '16px 0 8px' }}>Members</div>
      {contacts.length === 0 ? (
        <p className="modal-note">Add contacts first — you are always a member of your own groups.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {contacts.map((c) => (
            <button key={c.id} className="row" style={{ minHeight: 40, borderRadius: 8 }}
              aria-pressed={picked.has(c.id!)} onClick={() => toggle(c.id!)}>
              <span className={`mono`} style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center',
                background: 'var(--g-4)', color: 'var(--fg-secondary)', fontSize: 11 }}>
                {(c.nickname ?? c.publicKeyHex).slice(0, 2).toUpperCase()}
              </span>
              <span className="row-body">
                <span className="row-name">{c.nickname ?? c.publicKeyHex.slice(0, 12) + '…'}</span>
              </span>
              <span className={`chip ${picked.has(c.id!) ? '' : ''}`} aria-pressed={picked.has(c.id!)}>
                {picked.has(c.id!) ? 'Selected' : 'Select'}
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
