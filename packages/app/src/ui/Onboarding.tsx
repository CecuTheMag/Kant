/**
 * Everything before the app: boot, welcome + terms, network (only when the
 * build has no default relay), create a password, and unlock.
 */
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { getRelayInfo } from '@kant/core';
import { Alert, Bubble, Eye, EyeOff, LockFill, Person, Spinner } from './icons';
import { normalizeRelayUrl, parseInvite, savePendingInvite } from './lib';
import { Sheet } from './parts';

const TERMS_URL = 'https://kant.network/terms';

function AppIcon({ small }: { small?: boolean }) {
  return <div className={`k-app-icon${small ? ' is-small' : ''}`}><img src="/logo-clean.png" alt="" /></div>;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="k-onboard"><div className="k-onboard-card">{children}</div></div>;
}

function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="k-steps-dots" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={i + 1 === step ? 'is-on' : ''} />)}
    </div>
  );
}

export function Boot() {
  return <div className="k-boot" aria-label="Loading"><img src="/logo-clean.png" alt="" /></div>;
}

/* ── Welcome ──────────────────────────────────────────────────────── */

export function Welcome({ onContinue, totalSteps }: { onContinue: () => void; totalSteps: number }) {
  return (
    <Shell>
      <div className="k-onboard-top">
        <AppIcon />
        <h1>Welcome to Kant</h1>
        <p className="k-onboard-lede">Private messaging with no one in the middle.</p>
        <ul className="k-features">
          <li>
            <span className="k-feat-icon"><LockFill size={20} /></span>
            <div><b>Private by design</b><span>Messages are locked on your device and can only be opened by the person you send them to.</span></div>
          </li>
          <li>
            <span className="k-feat-icon"><Person size={20} /></span>
            <div><b>No phone number, no email</b><span>There’s no account to create. Your identity lives only on this device.</span></div>
          </li>
          <li>
            <span className="k-feat-icon"><Bubble size={20} /></span>
            <div><b>Nothing kept in the middle</b><span>No company server stores your conversations.</span></div>
          </li>
        </ul>
      </div>
      <div className="k-onboard-bottom">
        {totalSteps > 1 && <Dots step={1} total={totalSteps} />}
        <p className="k-legal">
          By tapping Agree and continue, you accept the <a href={TERMS_URL} target="_blank" rel="noreferrer">Terms of Service</a>.
        </p>
        <button className="k-btn k-btn-primary k-btn-block" onClick={onContinue}>Agree and continue</button>
      </div>
    </Shell>
  );
}

/* ── Network ──────────────────────────────────────────────────────── */

export function NetworkStep({ onConfigured, step, totalSteps }: { onConfigured: (url: string) => void; step: number; totalSteps: number }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    // An invite link from a friend carries their network — use it and add
    // the friend automatically once setup finishes.
    const invite = parseInvite(value);
    let url = normalizeRelayUrl(value);
    if (invite?.relay) url = invite.relay;
    else if (invite) { setError('That link doesn’t include a network. Ask your friend for the network address too.'); return; }
    try { new URL(url); } catch { setError('That doesn’t look like a web address.'); return; }

    setBusy(true);
    try {
      const info = await getRelayInfo(undefined, url);
      if (!info?.peerId || !info.multiaddr) throw new Error('bad relay');
      if (invite) savePendingInvite(invite);
      onConfigured(url);
    } catch {
      setError('Couldn’t reach that network. Check the address and your internet connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="k-contents" onSubmit={submit}>
        <div className="k-onboard-top">
        <AppIcon small />
        <h1>Connect to a network</h1>
        <p className="k-onboard-lede">
          Kant uses a relay to help your messages find each other. It only ever passes along sealed, unreadable data.
        </p>
        <div className="k-onboard-form">
          <div>
            <label className="k-field-label" htmlFor="relay">Invite link or network address</label>
            <input id="relay" className={`k-field${error ? ' is-error' : ''}`} value={value} onChange={(e) => setValue(e.target.value)}
              placeholder="relay.example.com" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" />
            {error ? <p className="k-error"><Alert size={16} />{error}</p>
              : <p className="k-hint">Got an invite link from a friend? Paste it here — it sets everything up for you.</p>}
          </div>
        </div>
        </div>
        <div className="k-onboard-bottom">
          <Dots step={step} total={totalSteps} />
          <button className="k-btn k-btn-primary k-btn-block" disabled={busy || !value.trim()}>
            {busy ? <><Spinner size={18} /> Connecting…</> : 'Continue'}
          </button>
        </div>
      </form>
    </Shell>
  );
}

/* ── Create password ──────────────────────────────────────────────── */

function strength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return pw.length ? 1 : 0;
  let score = 1;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[^A-Za-z]/.test(pw)) score++;
  return Math.min(score, 3) as 0 | 1 | 2 | 3;
}
const STRENGTH = ['', 'Weak', 'Good', 'Strong'];
const STRENGTH_COLOR = ['', 'var(--danger)', 'var(--warn)', 'var(--ok)'];

export function CreateStep({ onCreate, step, totalSteps }: {
  onCreate: (password: string, name: string) => Promise<void>; step: number; totalSteps: number;
}) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const s = strength(pw);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setError('The passwords don’t match.'); return; }
    setBusy(true);
    try {
      await onCreate(pw, name);
    } catch {
      setError('Something went wrong setting up. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="k-contents" onSubmit={submit}>
        <div className="k-onboard-top">
        <AppIcon small />
        <h1>Set up Kant</h1>
        <p className="k-onboard-lede">
          Your password locks Kant on this device. There’s no account, so it can’t be reset — keep it somewhere safe.
        </p>
        <div className="k-onboard-form">
          <div>
            <label className="k-field-label" htmlFor="name">Your name <span className="k-faint">(optional)</span></label>
            <input id="name" className="k-field" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="How friends will see you" autoComplete="nickname" maxLength={40} />
          </div>
          <div>
            <label className="k-field-label" htmlFor="pw">Password</label>
            <div className="k-field-wrap">
              <input id="pw" className="k-field" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="At least 8 characters" autoComplete="new-password" />
              <button type="button" className="k-icon-btn is-muted k-field-eye" onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </div>
            {pw && (
              <div className="k-strength" aria-live="polite">
                {[1, 2, 3].map((i) => <i key={i} style={{ background: i <= s ? STRENGTH_COLOR[s] : undefined }} />)}
                <span>{STRENGTH[s]}</span>
              </div>
            )}
          </div>
          <div>
            <label className="k-field-label" htmlFor="pw2">Confirm password</label>
            <input id="pw2" className="k-field" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="Type it again" autoComplete="new-password" />
          </div>
          {error && <p className="k-error" role="alert"><Alert size={16} />{error}</p>}
        </div>
        </div>
        <div className="k-onboard-bottom">
          {totalSteps > 1 && <Dots step={step} total={totalSteps} />}
          <button className="k-btn k-btn-primary k-btn-block" disabled={busy || !pw || !pw2}>
            {busy ? <><Spinner size={18} /> Creating your keys…</> : 'Create'}
          </button>
        </div>
      </form>
    </Shell>
  );
}

/* ── Unlock ───────────────────────────────────────────────────────── */

export function Unlock({ onUnlock, onErase }: { onUnlock: (pw: string) => Promise<boolean>; onErase: () => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setError('');
    try {
      const ok = await onUnlock(pw);
      if (!ok) { setError('Wrong password. Try again.'); setPw(''); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="k-contents" onSubmit={submit}>
        <div className="k-onboard-top" style={{ alignItems: 'center', textAlign: 'center' }}>
        <AppIcon />
        <h1>Welcome back</h1>
        <p className="k-onboard-lede">Enter your password to unlock Kant.</p>
        <div className="k-onboard-form" style={{ width: '100%', textAlign: 'left' }}>
          <div className="k-field-wrap">
            <input className={`k-field${error ? ' is-error' : ''}`} type={show ? 'text' : 'password'} value={pw}
              onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" autoFocus aria-label="Password" />
            <button type="button" className="k-icon-btn is-muted k-field-eye" onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
          </div>
          {error && <p className="k-error" role="alert"><Alert size={16} />{error}</p>}
        </div>
        </div>
        <div className="k-onboard-bottom">
          <button className="k-btn k-btn-primary k-btn-block" disabled={busy || !pw}>
            {busy ? <><Spinner size={18} /> Unlocking…</> : 'Unlock'}
          </button>
          <button type="button" className="k-btn k-btn-plain" onClick={() => setForgot(true)}>Forgot password?</button>
        </div>
      </form>

      {forgot && <ForgotSheet onClose={() => setForgot(false)} onErase={onErase} />}
    </Shell>
  );
}

function ForgotSheet({ onClose, onErase }: { onClose: () => void; onErase: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet onClose={onClose} label="Forgot password">
      <div className="k-sheet-hero" style={{ paddingTop: 22 }}>
        <div className="k-result-icon bad" style={{ width: 64, height: 64 }}><LockFill size={28} /></div>
        <h2 className="k-title-2">Your password can’t be reset</h2>
        <p>
          Kant has no account and no server copy — that’s what keeps it private. Without the password, the only option is to
          erase this device and start fresh. Your contacts and messages on this device will be deleted.
        </p>
      </div>
      <div className="k-sheet-foot">
        <button className="k-btn k-btn-danger k-btn-block" disabled={busy}
          onClick={async () => { setBusy(true); try { await onErase(); onClose(); } finally { setBusy(false); } }}>
          {busy ? <Spinner size={18} /> : 'Erase and start over'}
        </button>
        <button className="k-btn k-btn-secondary k-btn-block" onClick={onClose}>Keep trying</button>
      </div>
    </Sheet>
  );
}

/* ── Terms (existing users on a new Terms version) ────────────────── */

export function TermsUpdate({ onAccept }: { onAccept: () => void }) {
  return (
    <Shell>
      <div className="k-onboard-top">
        <AppIcon small />
        <h1>Updated Terms of Service</h1>
        <p className="k-onboard-lede">
          Kant is peer-to-peer software: nobody at the Kant Project — including any relay operator — can read your messages,
          and there’s no central server holding your data. That also means the Kant Project can’t monitor or moderate what
          anyone sends. You’re responsible for how you use Kant, and the software is provided as is, without warranty.
        </p>
        <p className="k-onboard-lede" style={{ fontSize: 15 }}>
          Read the full <a href={TERMS_URL} target="_blank" rel="noreferrer">Terms of Service</a>.
        </p>
      </div>
      <div className="k-onboard-bottom">
        <button className="k-btn k-btn-primary k-btn-block" onClick={onAccept}>Agree and continue</button>
      </div>
    </Shell>
  );
}

