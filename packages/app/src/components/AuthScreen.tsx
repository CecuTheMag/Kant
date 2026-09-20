import { useState } from 'react';
import { Eye, EyeOff, Alert, Spinner } from './icons';

interface Props {
  mode: 'setup' | 'unlock';
  onSetup: (password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<boolean>;
  onDeleteIdentity?: () => Promise<void>;
}

function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 6) return 0;
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score + 1, 3) as 0 | 1 | 2 | 3;
}

const strengthLabel = ['', 'Weak', 'Good', 'Strong'];
const strengthColor = ['', '#f87171', '#fbbf24', '#34d399'];

export function AuthScreen({ mode, onSetup, onUnlock, onDeleteIdentity }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isSetup = mode === 'setup';
  const strength = isSetup ? passwordStrength(password) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (isSetup && password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      if (isSetup) {
        await onSetup(password);
      } else {
        const ok = await onUnlock(password);
        if (!ok) setError('Incorrect password');
      }
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeleteIdentity() {
    if (!onDeleteIdentity) return;
    setDeleting(true);
    setError('');
    try {
      await onDeleteIdentity();
    } catch {
      setError('Identity wipe failed.');
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  return (
    <div style={s.root}>
      {/* Ambient background orbs */}
      <div style={s.orb1} />
      <div style={s.orb2} />

      <div
        style={s.card}
        className={`auth-card-mobile glass pop-in`}
      >
        {/* Logo */}
        <div style={s.logoRow}>
          <img src="/logo-clean.png" alt="Kant" style={s.logoImg} />
        </div>

        <div style={s.headingBlock}>
          <h1 style={s.heading}>
            {isSetup ? 'Create your identity' : 'Welcome back'}
          </h1>
          <p style={s.subheading}>
            {isSetup
              ? 'Your keypair is generated locally. No account and no central identity service.'
              : 'Unlock your encrypted identity to continue.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={s.form}>
          {/* Password field */}
          <div style={s.field}>
            <label style={s.label}>Password</label>
            <div style={s.inputWrap}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                style={s.input}
                autoFocus
                autoComplete={isSetup ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={s.eyeBtn}
                tabIndex={-1}
                title={showPw ? 'Hide password' : 'Show password'}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Strength meter — only on setup */}
            {isSetup && password.length > 0 && (
              <div style={s.strengthRow}>
                <div style={s.strengthBar}>
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      style={{
                        ...s.strengthSegment,
                        background: strength >= i ? strengthColor[strength] : 'var(--bg4)',
                        transition: 'background 0.3s',
                      }}
                    />
                  ))}
                </div>
                <span style={{ ...s.strengthLabel, color: strengthColor[strength] }}>
                  {strengthLabel[strength]}
                </span>
              </div>
            )}
          </div>

          {/* Confirm field */}
          {isSetup && (
            <div style={s.field}>
              <label style={s.label}>Confirm password</label>
              <div style={s.inputWrap}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  style={s.input}
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {error && (
            <div style={s.errorBox} className="fade-in">
              <Alert size={14} color="var(--red)" />
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={s.submitBtn}>
            {loading
              ? <><Spinner size={16} color="#fff" /> Working…</>
              : isSetup ? 'Create Identity' : 'Unlock'}
          </button>

          {!isSetup && onDeleteIdentity && (
            deleteConfirm ? (
              <div style={s.deleteConfirmBox} role="alert">
                <div style={s.deleteWarning}>
                  <Alert size={15} color="var(--red)" />
                  <span>This permanently removes your identity, contacts, and messages from this device.</span>
                </div>
                <div style={s.deleteActions}>
                  <button type="button" disabled={deleting} onClick={() => setDeleteConfirm(false)} style={s.cancelBtn}>
                    Cancel
                  </button>
                  <button type="button" disabled={deleting} onClick={confirmDeleteIdentity} style={s.deleteBtn}>
                    {deleting ? <><Spinner size={15} color="var(--red)" /> Removing…</> : 'Confirm removal'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => { setError(''); setDeleteConfirm(true); }}
                style={s.deleteBtn}
              >
                Remove identity from this device
              </button>
            )
          )}
        </form>

        <p style={s.footer}>
          <span style={s.footerDot}>●</span>
          No central message store. No account. End-to-end encrypted.
        </p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg0)',
    position: 'relative',
    overflow: 'hidden',
  },
  orb1: {
    position: 'absolute',
    width: 600,
    height: 600,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(79,142,247,0.12) 0%, transparent 70%)',
    top: '-200px',
    left: '-200px',
    pointerEvents: 'none',
  },
  orb2: {
    position: 'absolute',
    width: 500,
    height: 500,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 70%)',
    bottom: '-150px',
    right: '-150px',
    pointerEvents: 'none',
  },
  card: {
    width: 400,
    borderRadius: 24,
    padding: '44px 40px',
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
    position: 'relative',
    zIndex: 1,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
  },
  logoImg: {
    height: 48,
    width: 'auto',
    display: 'block',
  },
  headingBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: -8,
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text1)',
    letterSpacing: '-0.4px',
  },
  subheading: {
    fontSize: 13,
    color: 'var(--text2)',
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
  },
  inputWrap: {
    position: 'relative',
  },
  input: {
    width: '100%',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 9,
    padding: '13px 44px 13px 16px',
    color: 'var(--text1)',
    // 16px, not 14: below 16 a mobile browser zooms the viewport when the field
    // takes focus, and the user has to pinch back out to see the button they
    // were about to press.
    fontSize: 16,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  } as React.CSSProperties,
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 16,
    opacity: 0.5,
    minHeight: 'unset',
    padding: 4,
  },
  strengthRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  strengthBar: {
    display: 'flex',
    gap: 4,
    flex: 1,
  },
  strengthSegment: {
    flex: 1,
    height: 3,
    borderRadius: 99,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: 600,
    minWidth: 40,
    textAlign: 'right',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--red)',
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 9,
    padding: '10px 14px',
  } as React.CSSProperties,
  submitBtn: {
    background: 'linear-gradient(135deg, #4f8ef7 0%, #6b7cf7 100%)',
    color: '#fff',
    borderRadius: 9,
    padding: '13px',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '0.2px',
    boxShadow: '0 4px 16px rgba(79,142,247,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    transition: 'opacity 0.15s, transform 0.1s, box-shadow 0.15s',
  } as React.CSSProperties,
  deleteConfirmBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    borderRadius: 9,
    border: '1px solid rgba(248,113,113,0.35)',
    background: 'rgba(248,113,113,0.08)',
  },
  deleteWarning: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    color: 'var(--red)',
    fontSize: 12,
    lineHeight: 1.45,
  },
  deleteActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: {
    padding: '9px 13px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg3)',
    color: 'var(--text2)',
    cursor: 'pointer',
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '9px 13px',
    borderRadius: 8,
    border: '1px solid rgba(248,113,113,0.5)',
    background: 'rgba(248,113,113,0.1)',
    color: 'var(--red)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  footer: {
    fontSize: 12,
    color: 'var(--text3)',
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerDot: {
    fontSize: 6,
    color: 'var(--green)',
  },
};
