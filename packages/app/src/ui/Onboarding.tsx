/**
 * Everything before the app: boot, welcome + terms, network (only when the
 * build has no default relay), create a password, and unlock.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { getRelayInfo, isBackupFile } from '@kant/core';
import { QRCodeSVG } from 'qrcode.react';
import { Alert, Bubble, Check, ChevronLeft, Copy, Doc, Eye, EyeOff, Fingerprint, LockFill, Person, Spinner } from './icons';
import { copyText } from './lib';
import { normalizeRelayUrl, parseInvite, savePendingInvite } from './lib';
import { Sheet } from './parts';
import { biometricText } from '../lib/biometric';

const TERMS_URL = 'https://kant.network/terms';
// Relative to the build's base ('./' in the desktop app, which loads from
// file:// where "/logo-clean.png" would point at the root of the drive).
const LOGO_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}logo-clean.png`;

function AppIcon({ small }: { small?: boolean }) {
  return <div className={`k-app-icon${small ? ' is-small' : ''}`}><img src={LOGO_URL} alt="" /></div>;
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
  return <div className="k-boot" aria-label="Loading"><img src={LOGO_URL} alt="" /></div>;
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

export function CreateStep({ onCreate, step, totalSteps, onMoveIn, onRestore }: {
  onCreate: (password: string, name: string) => Promise<void>; step: number; totalSteps: number;
  /** Already use Kant: bring the account over instead of creating one. */
  onMoveIn?: () => void; onRestore?: () => void;
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
          {(onMoveIn || onRestore) && (
            <div className="k-alt-actions" role="group" aria-label="Already use Kant?">
              <span className="k-footnote k-muted">Already use Kant?</span>
              {onMoveIn && <button type="button" className="k-btn k-btn-plain" onClick={onMoveIn}>Move from your other phone</button>}
              {onRestore && <button type="button" className="k-btn k-btn-plain" onClick={onRestore}>Restore a backup</button>}
            </div>
          )}
        </div>
      </form>
    </Shell>
  );
}

/* ── Move from another device ─────────────────────────────────────── */

type ReceiveMove = (handlers: {
  onCode: (code: string) => void;
  onHello: (sas: string, decide: (accept: boolean) => void) => void;
  onProgress?: (pieces: number) => void;
}) => Promise<{ result: Promise<void>; stop: () => Promise<void> }>;

function moveError(e: unknown): string {
  const code = (e as Error)?.message;
  if (code === 'NO_RELAY' || code === 'NO_ADDRESS') return 'Can’t reach the network right now. Check your connection and try again.';
  if (code === 'BAD_KEY') return 'This transfer couldn’t be verified, so nothing was saved. Start again on both phones.';
  return 'The move didn’t finish, so nothing was saved on this phone. Start again on both phones.';
}

export function MoveInScreen({ receive, onBack }: { receive: ReceiveMove; onBack: () => void }) {
  const [phase, setPhase] = useState<'starting' | 'code' | 'compare' | 'receiving' | 'error'>('starting');
  const [code, setCode] = useState('');
  const [sas, setSas] = useState('');
  const [pieces, setPieces] = useState(0);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const decideRef = useRef<((accept: boolean) => void) | null>(null);
  // The caller's function changes identity every render; the node must start once per attempt.
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  useEffect(() => {
    let live = true;
    let stop: (() => Promise<void>) | null = null;
    setPhase('starting'); setNote('');
    receiveRef.current({
      onCode: (c) => { if (live) { setCode(c); setPhase('code'); } },
      onHello: (s, decide) => { if (!live) { decide(false); return; } decideRef.current = decide; setSas(s); setPhase('compare'); },
      onProgress: (n) => { if (live) { setPieces(n); setPhase('receiving'); } },
    }).then(({ result, stop: st }) => {
      stop = st;
      if (!live) { void st(); return; }
      result.catch((e) => { if (live) { setNote(moveError(e)); setPhase('error'); } });
    }).catch((e) => { if (live) { setNote(moveError(e)); setPhase('error'); } });
    return () => { live = false; decideRef.current?.(false); void stop?.(); };
  }, [attempt]);

  const decide = (accept: boolean) => {
    const d = decideRef.current;
    decideRef.current = null;
    d?.(accept);
    if (accept) setPhase('receiving');
    else { setPhase('code'); setNote('The codes didn’t match, so nothing was accepted. If you didn’t start this on your other phone, someone else may have seen this code — close this screen and open it again for a new one.'); }
  };

  return (
    <Shell>
      <div className="k-contents">
        <div className="k-onboard-top">
          <button type="button" className="k-btn k-btn-plain" style={{ alignSelf: 'flex-start', marginLeft: -12 }} onClick={onBack}>
            <ChevronLeft size={20} /> Back
          </button>
          <h1>Move from your other phone</h1>
          {phase === 'starting' && <p className="k-onboard-lede"><Spinner size={18} /> Getting ready…</p>}
          {phase === 'code' && (
            <>
              <p className="k-onboard-lede">On your other phone open Kant → <b>Settings</b> → <b>Move to a new phone</b>, and scan this code.</p>
              <div className="k-move-qr"><QRCodeSVG value={code} level="L" marginSize={0} bgColor="#ffffff" fgColor="#1d1d1f" aria-label="Move code" /></div>
              <button type="button" className="k-btn k-btn-plain" onClick={() => { void copyText(code); setCopied(true); }}>
                {copied ? <><Check size={18} /> Copied</> : <><Copy size={18} /> Copy code instead</>}
              </button>
              {note && <p className="k-error" role="alert"><Alert size={16} />{note}</p>}
            </>
          )}
          {phase === 'compare' && (
            <>
              <p className="k-onboard-lede">Check that your other phone shows the same code.</p>
              <div className="k-sas" aria-label={`Code ${sas.split('').join(' ')}`}>{sas.slice(0, 3)} {sas.slice(3)}</div>
            </>
          )}
          {phase === 'receiving' && (
            <p className="k-onboard-lede"><Spinner size={18} /> Receiving your account… {pieces > 0 && <span className="k-faint">({pieces} parts)</span>}<br />Keep both phones open.</p>
          )}
          {phase === 'error' && <p className="k-error" role="alert"><Alert size={16} />{note}</p>}
        </div>
        <div className="k-onboard-bottom">
          {phase === 'compare' && (
            <>
              <button type="button" className="k-btn k-btn-primary k-btn-block" onClick={() => decide(true)}>The codes match</button>
              <button type="button" className="k-btn k-btn-secondary k-btn-block" onClick={() => decide(false)}>They don’t match</button>
            </>
          )}
          {phase === 'error' && (
            <button type="button" className="k-btn k-btn-primary k-btn-block" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* ── Restore a backup ─────────────────────────────────────────────── */

export function RestoreScreen({ restore, onBack }: { restore: (bytes: Uint8Array, password: string) => Promise<void>; onBack: () => void }) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    setError('');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!isBackupFile(bytes)) { setFile(null); setError('That isn’t a Kant backup file.'); return; }
    setFile({ name: f.name, bytes });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !pw) return;
    setBusy(true);
    setError('');
    try {
      await restore(file.bytes, pw);
    } catch (err) {
      const code = (err as Error)?.message;
      setError(code === 'WRONG_PASSWORD' ? 'That password doesn’t open this backup.'
        : code === 'NOT_A_BACKUP' ? 'That isn’t a Kant backup file.'
        : code === 'IDENTITY_EXISTS' ? 'This device already has an account.'
        : 'The backup is damaged or incomplete, so nothing was restored.');
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="k-contents" onSubmit={submit}>
        <div className="k-onboard-top">
          <button type="button" className="k-btn k-btn-plain" style={{ alignSelf: 'flex-start', marginLeft: -12 }} onClick={onBack}>
            <ChevronLeft size={20} /> Back
          </button>
          <h1>Restore a backup</h1>
          <p className="k-onboard-lede">Choose your Kant backup file and enter the password your account had when you saved it.</p>
          <div className="k-onboard-form">
            <input ref={input} type="file" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="k-btn k-btn-secondary k-btn-block" onClick={() => input.current?.click()}>
              <Doc size={18} /> {file ? file.name : 'Choose backup file'}
            </button>
            {file && (
              <input className="k-field" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="Account password" aria-label="Account password" autoComplete="current-password" autoFocus />
            )}
            {error && <p className="k-error" role="alert"><Alert size={16} />{error}</p>}
            <p className="k-footnote k-muted">Chats continue where they left off. The first message in each chat quietly sets up a fresh secure session.</p>
          </div>
        </div>
        <div className="k-onboard-bottom">
          <button className="k-btn k-btn-primary k-btn-block" disabled={busy || !file || !pw}>
            {busy ? <><Spinner size={18} /> Restoring…</> : 'Restore'}
          </button>
        </div>
      </form>
    </Shell>
  );
}

/* ── Unlock ───────────────────────────────────────────────────────── */

export function Unlock({ onUnlock, onErase, biometric }: {
  onUnlock: (pw: string) => Promise<boolean>; onErase: () => Promise<void>;
  /** Fingerprint unlock, where the device and the user's settings allow it. */
  biometric?: {
    /** null = ready; 'unavailable' = don't mention it; anything else = why the password is needed. */
    block: () => Promise<string | null>;
    unlock: () => Promise<{ ok: true } | { ok: false; message?: string }>;
  };
}) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  // Never prompts on its own: a fingerprint is asked for only when the user taps.
  const [bio, setBio] = useState<'hidden' | 'ready' | { note: string }>('hidden');
  const [bioBusy, setBioBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void biometric?.block().then((b) => { if (live) setBio(b === null ? 'ready' : b === 'unavailable' ? 'hidden' : { note: b }); })
      .catch(() => {});
    return () => { live = false; };
  }, [biometric]);

  async function fingerprint() {
    if (!biometric) return;
    setBioBusy(true);
    setError('');
    try {
      const r = await biometric.unlock();
      if (!r.ok && r.message) setBio({ note: r.message });
    } finally {
      setBioBusy(false);
    }
  }

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
          {typeof bio === 'object' && <p className="k-hint" role="status">{bio.note}</p>}
        </div>
        </div>
        <div className="k-onboard-bottom">
          <button className="k-btn k-btn-primary k-btn-block" disabled={busy || !pw}>
            {busy ? <><Spinner size={18} /> Unlocking…</> : 'Unlock'}
          </button>
          {bio === 'ready' && (
            <button type="button" className="k-btn k-btn-secondary k-btn-block" disabled={bioBusy || busy} onClick={fingerprint}>
              {bioBusy ? <Spinner size={18} /> : <Fingerprint size={20} />} Unlock with {biometricText().name}
            </button>
          )}
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

