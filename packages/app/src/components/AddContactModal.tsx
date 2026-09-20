import { useState } from 'react';
import { Alert, Spinner } from './icons';

interface Props {
  onAdd: (hex: string, nick?: string, circuitAddr?: string) => Promise<void>;
  onClose: () => void;
}

export function AddContactModal({ onAdd, onClose }: Props) {
  const [hex, setHex]         = useState('');
  const [nick, setNick]       = useState('');
  const [addr, setAddr]       = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = hex.trim();
    if (trimmed.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      setError('Public key must be exactly 64 hexadecimal characters');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onAdd(trimmed, nick.trim() || undefined, addr.trim() || undefined);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add contact');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} className="modal-mobile-full fade-up" onClick={e => e.stopPropagation()}>
        {/* Handle bar (mobile) */}
        <div style={s.handle} />

        <div style={s.header}>
          <div>
            <h2 style={s.title}>Add Contact</h2>
            <p style={s.subtitle}>Enter their public key to connect</p>
          </div>
          <button onClick={onClose} style={s.closeBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.field}>
            <label style={s.label}>Public Key</label>
            <input
              value={hex}
              onChange={e => setHex(e.target.value)}
              placeholder="64 hex characters…"
              style={{
                ...s.input,
                borderColor: hex.length > 0 && hex.length !== 64 ? 'var(--red)' : undefined,
              }}
              spellCheck={false}
              autoFocus
              autoComplete="off"
            />
            {hex.length > 0 && (
              <div style={s.keyProgress}>
                <div style={{
                  ...s.keyProgressBar,
                  width: `${Math.min(100, (hex.length / 64) * 100)}%`,
                  background: hex.length === 64 ? 'var(--green)' : hex.length > 64 ? 'var(--red)' : 'var(--accent)',
                }} />
                <span style={{ fontSize: 11, color: hex.length === 64 ? 'var(--green)' : 'var(--text3)' }}>
                  {hex.length}/64
                </span>
              </div>
            )}
          </div>

          <div style={s.field}>
            <label style={s.label}>Nickname <span style={s.optional}>optional</span></label>
            <input
              value={nick}
              onChange={e => setNick(e.target.value)}
              placeholder="e.g. Alice"
              style={s.input}
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>Circuit Address <span style={s.optional}>optional</span></label>
            <input
              value={addr}
              onChange={e => setAddr(e.target.value)}
              placeholder="/ip4/…/p2p-circuit/p2p/…"
              style={{ ...s.input, fontFamily: 'monospace', fontSize: 12 }}
              spellCheck={false}
            />
            <p style={s.hint}>Paste once — Kant will keep it updated automatically</p>
          </div>

          {error && (
            <div style={s.errorBox} className="fade-in">
              <Alert size={14} color="var(--red)" />
              {error}
            </div>
          )}

          <div style={s.btns}>
            <button type="button" onClick={onClose} style={s.cancelBtn}>Cancel</button>
            <button type="submit" disabled={loading} style={s.addBtn}>
              {loading
                ? <><Spinner size={14} color="#fff" /> Adding…</>
                : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, backdropFilter: 'blur(8px)',
  },
  modal: {
    width: 440,
    background: 'var(--bg1)',
    borderRadius: 20,
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4, borderRadius: 99,
    background: 'var(--bg4)', margin: '12px auto 0',
    display: 'none', // shown via CSS on mobile
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '24px 24px 0',
  },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text1)', letterSpacing: '-0.3px' },
  subtitle: { fontSize: 13, color: 'var(--text3)', marginTop: 4 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text3)', background: 'var(--bg3)', flexShrink: 0, minHeight: 'unset',
  },
  form: { padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18 },
  field: { display: 'flex', flexDirection: 'column', gap: 7 },
  label: {
    fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: '0.7px',
    display: 'flex', alignItems: 'center', gap: 6,
  },
  optional: {
    fontSize: 10, color: 'var(--text3)', fontWeight: 400,
    textTransform: 'none', letterSpacing: 0,
    background: 'var(--bg4)', borderRadius: 4, padding: '1px 5px',
  },
  input: {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '11px 14px', color: 'var(--text1)',
    fontSize: 13, transition: 'border-color 0.15s, box-shadow 0.15s',
    width: '100%',
  },
  keyProgress: {
    display: 'flex', alignItems: 'center', gap: 8, marginTop: 2,
  },
  keyProgressBar: {
    flex: 1, height: 3, borderRadius: 99,
    background: 'var(--accent)', transition: 'width 0.2s, background 0.2s',
  },
  hint: { fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 },
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
  addBtn: {
    background: 'linear-gradient(135deg,#4f8ef7,#6b7cf7)',
    color: '#fff', borderRadius: 10, padding: '10px 20px',
    fontSize: 13, fontWeight: 600,
    boxShadow: '0 4px 16px rgba(79,142,247,0.3)',
    display: 'flex', alignItems: 'center', gap: 6,
  },
};
