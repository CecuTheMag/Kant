import { useState } from 'react';
import type { Contact, GroupMember } from '@kant/core';
import { Alert, Spinner } from './icons';

interface Props {
  contacts: Contact[];
  myCircuitAddr: string;
  onClose: () => void;
  onCreate: (name: string, members: GroupMember[]) => Promise<void>;
}

export function CreateGroupModal({ contacts, onClose, onCreate }: Props) {
  const [name, setName]         = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addrs, setAddrs]       = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  function toggleMember(hex: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(hex)) {
        next.delete(hex);
      } else {
        next.add(hex);
        // Seed addrs from lastCircuitAddr so the user doesn't have to type it
        const contact = contacts.find(c => c.publicKeyHex === hex);
        if (contact?.lastCircuitAddr) {
          setAddrs(p => ({ ...p, [hex]: p[hex] ?? contact.lastCircuitAddr! }));
        }
      }
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Group name is required'); return; }
    if (selected.size === 0) { setError('Select at least one member'); return; }
    for (const hex of selected) {
      const effectiveAddr = addrs[hex] || contacts.find(c => c.publicKeyHex === hex)?.lastCircuitAddr || '';
      if (!effectiveAddr.includes('/p2p-circuit')) {
        const c = contacts.find(c => c.publicKeyHex === hex);
        setError(`Enter circuit address for ${c?.nickname || hex.slice(0, 12)}…`);
        return;
      }
    }
    setLoading(true);
    setError('');
    try {
      const members: GroupMember[] = Array.from(selected).map(hex => ({
        publicKeyHex: hex,
        nickname:     contacts.find(c => c.publicKeyHex === hex)?.nickname,
        circuitAddr:  addrs[hex] || contacts.find(c => c.publicKeyHex === hex)?.lastCircuitAddr || '',
        joinedAt:     Date.now(),
      }));
      await onCreate(name.trim(), members);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} className="modal-mobile-full fade-up" onClick={e => e.stopPropagation()}>
        <div style={s.handle} />

        <div style={s.header}>
          <div>
            <h2 style={s.title}>New Group</h2>
            <p style={s.subtitle}>
              {selected.size === 0 ? 'Select members to add' : `${selected.size} member${selected.size !== 1 ? 's' : ''} selected`}
            </p>
          </div>
          <button onClick={onClose} style={s.closeBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleCreate} style={s.form}>
          <div style={s.field}>
            <label style={s.label}>Group Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Team Alpha"
              style={s.input}
              autoFocus
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Members</label>
            {contacts.length === 0 ? (
              <div style={s.emptyContacts}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                <span>No contacts — add contacts first</span>
              </div>
            ) : (
              <div style={s.memberList}>
                {contacts.map(c => {
                  const isSel = selected.has(c.publicKeyHex);
                  return (
                    <div key={c.publicKeyHex} style={s.memberRow} className="member-row">
                      <div
                        className="memberInfo"
                        style={{ ...s.checkbox, ...(isSel ? s.checkboxOn : {}) }}
                        onClick={() => toggleMember(c.publicKeyHex)}
                      >
                        {isSel && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </div>
                      <div style={s.memberInfo} className="memberInfo" onClick={() => toggleMember(c.publicKeyHex)}>
                        <span style={s.memberName}>{c.nickname || c.publicKeyHex.slice(0, 18) + '…'}</span>
                      </div>
                      {isSel && !c.lastCircuitAddr && (
                        <input
                          value={addrs[c.publicKeyHex] ?? ''}
                          onChange={e => setAddrs(p => ({ ...p, [c.publicKeyHex]: e.target.value }))}
                          placeholder="Circuit address…"
                          style={s.addrInput}
                          onClick={e => e.stopPropagation()}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div style={s.errorBox} className="fade-in">
              <Alert size={14} color="var(--red)" />
              {error}
            </div>
          )}

          <div style={s.btns}>
            <button type="button" onClick={onClose} style={s.cancelBtn}>Cancel</button>
            <button type="submit" disabled={loading} style={s.createBtn}>
              {loading
                ? <><Spinner size={14} color="#fff" /> Creating…</>
                : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, backdropFilter: 'blur(8px)',
  },
  modal: {
    width: 460, maxHeight: '82vh', background: 'var(--bg1)',
    borderRadius: 20, border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4, borderRadius: 99, background: 'var(--bg4)',
    margin: '12px auto 0', display: 'none',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '24px 24px 0', flexShrink: 0,
  },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text1)', letterSpacing: '-0.3px' },
  subtitle: { fontSize: 13, color: 'var(--text3)', marginTop: 4 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text3)', background: 'var(--bg3)', flexShrink: 0, minHeight: 'unset',
  },
  form: { padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.7px' },
  input: {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '11px 14px', color: 'var(--text1)', fontSize: 13,
    transition: 'border-color 0.15s, box-shadow 0.15s', width: '100%',
  },
  emptyContacts: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 13, color: 'var(--text3)', padding: '12px 0',
  },
  memberList: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' },
  memberRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', borderRadius: 10, background: 'var(--bg3)',
    border: '1px solid var(--border)', cursor: 'pointer',
    transition: 'background 0.12s',
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, border: '2px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.15s',
  },
  checkboxOn: { background: 'var(--accent)', borderColor: 'var(--accent)' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 13, fontWeight: 500, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  addrInput: {
    background: 'var(--bg4)', border: '1px solid var(--border)',
    borderRadius: 7, padding: '6px 9px', color: 'var(--text2)',
    fontSize: 11, fontFamily: 'monospace', width: 170, flexShrink: 0,
    transition: 'border-color 0.15s',
  },
  errorBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 13, color: 'var(--red)',
    background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 10, padding: '10px 14px',
  },
  btns: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 },
  cancelBtn: {
    background: 'var(--bg3)', color: 'var(--text2)',
    borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 500,
  },
  createBtn: {
    background: 'linear-gradient(135deg,#4f8ef7,#6b7cf7)', color: '#fff',
    borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 600,
    boxShadow: '0 4px 16px rgba(79,142,247,0.3)',
    display: 'flex', alignItems: 'center', gap: 6,
  },
};
