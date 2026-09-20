import { useState } from 'react';
import { getRelayInfo } from '@kant/core';
import { Spinner, Alert, Lock as LockIcon } from './icons';

interface Props {
  initialUrl: string;
  onConfigured: (url: string) => void;
}

export function RelaySetupScreen({ initialUrl, onConfigured }: Props) {
  const [url, setUrl] = useState(initialUrl === 'http://127.0.0.1:3001' ? '' : initialUrl);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim().replace(/\/$/, '');
    setError('');
    let parsed: URL;
    try {
      parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    } catch {
      setError('Enter a relay URL beginning with http:// or https://.');
      return;
    }

    setChecking(true);
    try {
      const info = await getRelayInfo(undefined, value);
      if (!info?.peerId || !info.multiaddr) {
        setError('The relay responded without a valid relay identity.');
        return;
      }
      onConfigured(value);
    } catch (err: any) {
      setError(`Could not reach this relay: ${err?.message ?? 'request failed'}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={s.root}>
      {/* Ambient background orbs — match AuthScreen */}
      <div style={s.orb1} />
      <div style={s.orb2} />

      <div style={s.card} className="glass pop-in auth-card-mobile">
        <div style={s.logoRow}>
          <img src="/logo-clean.png" alt="Kant" style={s.logo} />
        </div>

        <div style={s.headingBlock}>
          <h1 style={s.heading}>Choose your relay</h1>
          <p style={s.copy}>Enter the relay URL provided by your administrator — or run your own relay and paste its address.</p>
        </div>

        <form onSubmit={submit} style={s.form}>
          <label style={s.label} htmlFor="relay-url">Relay URL</label>
          <input
            id="relay-url"
            autoFocus
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://relay.example.com"
            style={s.input}
            autoComplete="url"
            spellCheck={false}
          />

          {error && (
            <div style={s.errorBox} className="fade-in">
              <Alert size={14} color="var(--red)" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={checking || !url.trim()} style={s.button}>
            {checking
              ? <><Spinner size={15} color="#fff" /> Checking relay…</>
              : 'Use this relay'}
          </button>
        </form>

        <div style={s.trustRow}>
          <LockIcon size={13} color="var(--green)" />
          <p style={s.note}>
            Your relay choice is saved on this device. You can change it any time in Settings.
          </p>
        </div>
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
    padding: 20,
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
    width: 420,
    maxWidth: '100%',
    padding: '44px 40px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    borderRadius: 24,
    position: 'relative',
    zIndex: 1,
  },
  logoRow: { display: 'flex', alignItems: 'center' },
  logo: { height: 44, width: 'auto', display: 'block' },
  headingBlock: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: -8 },
  heading: { fontSize: 22, fontWeight: 700, color: 'var(--text1)', letterSpacing: '-0.4px', margin: 0 },
  copy: { color: 'var(--text2)', fontSize: 13, lineHeight: 1.5, margin: 0 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: {
    fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: '0.7px',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '13px 14px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg3)',
    color: 'var(--text1)',
    // 16px: anything smaller makes a mobile browser zoom on focus, and this is
    // the very first field anyone sees.
    fontSize: 16,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 10,
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.2)',
    color: 'var(--red)',
    fontSize: 13,
    lineHeight: 1.4,
  },
  button: {
    padding: '13px 16px',
    border: 0,
    borderRadius: 10,
    background: 'linear-gradient(135deg,#4f8ef7,#6b7cf7)',
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(79,142,247,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    transition: 'opacity 0.15s, transform 0.1s, box-shadow 0.15s',
  },
  trustRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 2,
  },
  note: { color: 'var(--text3)', fontSize: 11, lineHeight: 1.5, margin: 0, flex: 1 },
};
