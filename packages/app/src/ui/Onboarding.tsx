/**
 * Everything before the app: boot, welcome + terms, network (only when the
 * build has no default relay), create a password, and unlock. Each step is
 * one idea: a symbol, a title, a sentence, and one clear thing to do.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { getRelayInfo, isBackupFile } from '@kant/core';
import { QRCodeSVG } from 'qrcode.react';
import {
  Alert, ArrowUp, Bubble, Check, ChevronLeft, Copy, Doc, Eye, EyeOff, Fingerprint, Globe, Link as LinkIcon, LockFill, Person,
  Refresh, Scan, Spinner,
} from './icons';
import { copyText } from './lib';
import { normalizeRelayUrl, parseInvite, savePendingInvite } from './lib';
import { Avatar, Cell, Section, Sheet, SheetHead } from './parts';
import { QrScanner } from './Scanner';
import { success, warning } from '../lib/haptics';
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

/** The symbol that opens a setup step: one idea, in a soft circle. */
function HeroSymbol({ children, tone }: { children: ReactNode; tone?: 'ok' | 'danger' }) {
  return <div className={`k-hero-symbol${tone ? ` is-${tone}` : ''}`} aria-hidden="true">{children}</div>;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="k-btn k-btn-plain k-onboard-back" onClick={onBack}>
      <ChevronLeft size={20} /> Back
    </button>
  );
}

export function Boot() {
  return <div className="k-boot" aria-label="Loading"><img src={LOGO_URL} alt="" /></div>;
}

/* ── Welcome ──────────────────────────────────────────────────────── */

export function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <Shell>
      <div className="k-onboard-top">
        <div className="k-welcome-hero"><AppIcon /></div>
        <h1>Welcome to Kant</h1>
        <p className="k-onboard-lede">Private messaging with no one in the middle.</p>
        <ul className="k-features">
          <li>
            <span className="k-feat-icon is-blue"><LockFill size={30} /></span>
            <div><b>Private by design</b><span>Messages are locked on your device and can only be opened by the person you send them to.</span></div>
          </li>
          <li>
            <span className="k-feat-icon is-green"><Person size={30} stroke={2} /></span>
            <div><b>No phone number, no email</b><span>There’s no account to create. Your identity lives only on this device.</span></div>
          </li>
          <li>
            <span className="k-feat-icon is-brand"><Bubble size={30} stroke={2} /></span>
            <div><b>Nothing kept in the middle</b><span>No company server stores your conversations.</span></div>
          </li>
        </ul>
      </div>
      <div className="k-onboard-bottom">
        <p className="k-legal">
          By tapping Agree and continue, you accept the <a href={TERMS_URL} target="_blank" rel="noreferrer">Terms of Service</a>.
        </p>
        <button className="k-btn k-btn-primary k-btn-block" onClick={onContinue}>Agree and continue</button>
      </div>
    </Shell>
  );
}

/* ── Network ──────────────────────────────────────────────────────── */

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

export function NetworkStep({ onConfigured }: { onConfigured: (url: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const [scanning, setScanning] = useState(false);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  // What the text looks like so far: a friend's invite, a relay address, or nothing yet.
  const invite = parseInvite(value);
  const typedHost = !invite && value.trim().includes('.') ? hostOf(normalizeRelayUrl(value)) : '';

  async function connect(text: string) {
    setError('');
    // An invite link from a friend carries their network — use it and add
    // the friend automatically once setup finishes.
    const inv = parseInvite(text);
    let url = normalizeRelayUrl(text);
    if (inv?.relay) url = inv.relay;
    else if (inv) { setError('That link doesn’t include a network. Ask your friend for the network address too.'); return; }
    try { new URL(url); } catch { setError('That doesn’t look like a web address.'); return; }

    setPhase('busy');
    try {
      const info = await getRelayInfo(undefined, url);
      if (!info?.peerId || !info.multiaddr) throw new Error('bad relay');
      if (inv) savePendingInvite(inv);
      // Let "connected" register before the screen changes.
      setPhase('done');
      success();
      window.setTimeout(() => onConfigured(url), 450);
    } catch {
      setError('Couldn’t reach that network. Check the address and your internet connection.');
      setPhase('idle');
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); if (phase === 'idle' && value.trim()) void connect(value); };

  return (
    <Shell>
      <form className="k-contents" onSubmit={submit}>
        <div className="k-onboard-top">
          <HeroSymbol><Globe size={40} stroke={1.7} /></HeroSymbol>
          <h1>Connect to a network</h1>
          <p className="k-onboard-lede">
            Paste an invite link from a friend, or the address of a Kant relay. Relays only pass along sealed messages — they can’t read them.
          </p>
          <div className="k-onboard-form">
            <div className="k-field-wrap has-lead">
              <LinkIcon size={18} className="k-field-lead" />
              <input id="relay" className={`k-field${error ? ' is-error' : ''}`} value={value}
                onChange={(e) => { setValue(e.target.value); setError(''); }}
                placeholder="relay.example.com" aria-label="Invite link or network address"
                autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" enterKeyHint="go" />
              {canPaste && !value && (
                <button type="button" className="k-btn k-btn-secondary k-btn-sm k-btn-pill k-field-action" onClick={async () => {
                  try { const text = (await navigator.clipboard.readText()).trim(); if (text) { setValue(text); setError(''); } } catch { /* permission refused */ }
                }}>Paste</button>
              )}
            </div>
            {error ? <p className="k-error" role="alert"><Alert size={16} />{error}</p>
              : invite?.relay ? (
                <div className="k-found k-recognised">
                  <Avatar name={invite.name ?? ''} seed={invite.hex} size={40} />
                  <div className="k-found-body">
                    <div className="k-headline">Invite from {invite.name || 'a friend'}</div>
                    <div className="k-footnote k-muted">{hostOf(invite.relay)}</div>
                  </div>
                  <Check size={20} className="k-recognised-ok" />
                </div>
              ) : typedHost ? (
                <div className="k-found k-recognised">
                  <span className="k-recognised-icon"><Globe size={20} /></span>
                  <div className="k-found-body">
                    <div className="k-headline">{typedHost}</div>
                    <div className="k-footnote k-muted">Kant relay</div>
                  </div>
                </div>
              ) : <p className="k-hint">A friend finds their link in Kant under <b>My code</b> → <b>Copy link</b>.</p>}
          </div>
        </div>
        <div className="k-onboard-bottom">
          <button className="k-btn k-btn-primary k-btn-block" disabled={phase !== 'idle' || !value.trim()}>
            {phase === 'busy' ? <><Spinner size={18} /> Connecting…</> : phase === 'done' ? <><Check size={20} /> Connected</> : 'Continue'}
          </button>
          <button type="button" className="k-btn k-btn-plain" disabled={phase !== 'idle'} onClick={() => setScanning(true)}>
            <Scan size={20} /> Scan a friend’s code
          </button>
        </div>
      </form>

      {scanning && (
        <Sheet onClose={() => setScanning(false)} label="Scan a code">
          <SheetHead title="Scan a code" left={<button type="button" className="k-btn k-btn-plain" onClick={() => setScanning(false)}>Cancel</button>} />
          <div className="k-sheet-body">
            <QrScanner onResult={(text) => { setScanning(false); setValue(text); void connect(text); }} />
            <p className="k-footnote k-muted k-center" style={{ margin: '14px auto 0', maxWidth: '32ch' }}>
              Point your camera at the code on your friend’s phone. They’ll find it under <b>My code</b>.
            </p>
          </div>
        </Sheet>
      )}
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

export function CreateStep({ onCreate, onMoveIn, onRestore }: {
  onCreate: (password: string, name: string) => Promise<void>;
  /** Already use Kant: bring the account over instead of creating one. */
  onMoveIn?: () => void; onRestore?: () => void;
}) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);
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
          <div className="k-hero-avatar"><Avatar name={name} seed={name.trim() || 'kant'} size={88} /></div>
          <h1>Create your Kant</h1>
          <p className="k-onboard-lede">
            Your password locks Kant on this device. There’s no account, so it can’t be reset — keep it somewhere safe.
          </p>
          <div className="k-onboard-form">
            <div>
              <div className="k-group">
                <label className="k-cell">
                  <span className="k-cell-key">Name</span>
                  <input id="name" className="k-cell-input" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="How friends will see you" autoComplete="nickname" maxLength={40} enterKeyHint="next" />
                </label>
              </div>
              <p className="k-section-foot">Optional. Only shared in the invite link you send.</p>
            </div>
            <div>
              <div className="k-group">
                <div className="k-cell">
                  <label className="k-cell-key" htmlFor="pw">Password</label>
                  <input id="pw" className="k-cell-input" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)}
                    placeholder="At least 8 characters" autoComplete="new-password" enterKeyHint="next" />
                  <button type="button" className="k-icon-btn is-muted k-cell-eye" onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
                </div>
                <div className="k-cell">
                  <label className="k-cell-key" htmlFor="pw2">Confirm</label>
                  <input id="pw2" className="k-cell-input" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)}
                    placeholder="Type it again" autoComplete="new-password" enterKeyHint="go" />
                </div>
              </div>
              {error ? <p className="k-error" role="alert"><Alert size={16} />{error}</p>
                : pw && (
                  <div className="k-strength" aria-live="polite">
                    {[1, 2, 3].map((i) => <i key={i} style={{ background: i <= s ? STRENGTH_COLOR[s] : undefined }} />)}
                    <span>{STRENGTH[s]}</span>
                  </div>
                )}
            </div>
          </div>
        </div>
        <div className="k-onboard-bottom">
          <button className="k-btn k-btn-primary k-btn-block" disabled={busy || !pw || !pw2}>
            {busy ? <><Spinner size={18} /> Creating your keys…</> : 'Create'}
          </button>
          {(onMoveIn || onRestore) && (
            <button type="button" className="k-btn k-btn-plain" onClick={() => setExisting(true)}>I already use Kant</button>
          )}
        </div>
      </form>

      {existing && (
        <Sheet onClose={() => setExisting(false)} label="Already use Kant?">
          <SheetHead title="Already use Kant?" right={<button type="button" className="k-btn k-btn-plain is-bold" onClick={() => setExisting(false)}>Cancel</button>} />
          <div className="k-sheet-body">
            <Section icons foot="Either way your chats, contacts and keys come with you.">
              {onMoveIn && <Cell icon={<Refresh size={18} />} iconTone="green" label="Move from your other phone" sub="Both phones side by side" chevron
                onClick={() => { setExisting(false); onMoveIn(); }} />}
              {onRestore && <Cell icon={<Doc size={18} />} label="Restore a backup" sub="From a Kant backup file" chevron
                onClick={() => { setExisting(false); onRestore(); }} />}
            </Section>
          </div>
        </Sheet>
      )}
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
          <BackButton onBack={onBack} />
          <HeroSymbol tone="ok"><Refresh size={38} stroke={1.7} /></HeroSymbol>
          <h1>Move from your other phone</h1>
          {phase === 'starting' && <p className="k-onboard-lede"><Spinner size={18} /> Getting ready…</p>}
          {phase === 'code' && (
            <>
              <p className="k-onboard-lede">On your other phone open Kant → <b>Settings</b> → <b>Backup &amp; Transfer</b> → <b>Move to a new phone</b>, and scan this code.</p>
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
          <BackButton onBack={onBack} />
          <HeroSymbol><Doc size={38} stroke={1.7} /></HeroSymbol>
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
  const [misses, setMisses] = useState(0);
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
      if (!ok) { setError('Wrong password. Try again.'); setPw(''); setMisses((n) => n + 1); warning(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form className="k-contents" onSubmit={submit}>
        <div className="k-onboard-top">
          <AppIcon small />
          <h1>Kant is locked</h1>
          <p className="k-onboard-lede">Enter your password to unlock.</p>
          <div className="k-onboard-form">
            <div key={misses} className={`k-field-wrap has-submit${misses ? ' is-shake' : ''}`}>
              <input className={`k-field${error ? ' is-error' : ''}`} type={show ? 'text' : 'password'} value={pw}
                onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" autoFocus
                aria-label="Password" enterKeyHint="go" />
              <button type="button" className="k-icon-btn is-muted k-field-eye" onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
              <button className="k-field-submit" disabled={busy || !pw} aria-label="Unlock">
                {busy ? <Spinner size={16} /> : <ArrowUp size={16} style={{ transform: 'rotate(90deg)' }} />}
              </button>
            </div>
            {error && <p className="k-error" role="alert"><Alert size={16} />{error}</p>}
            {typeof bio === 'object' && <p className="k-hint" role="status">{bio.note}</p>}
            {bio === 'ready' && (
              <button type="button" className="k-bio-btn" disabled={bioBusy || busy} onClick={fingerprint}>
                <span>{bioBusy ? <Spinner size={26} /> : <Fingerprint size={30} />}</span>
                Unlock with {biometricText().name}
              </button>
            )}
          </div>
        </div>
        <div className="k-onboard-bottom">
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
        <button className="k-btn k-btn-primary k-btn-block" onClick={onClose}>Keep trying</button>
        <button className="k-btn k-btn-danger k-btn-block" disabled={busy}
          onClick={async () => { setBusy(true); try { await onErase(); onClose(); } finally { setBusy(false); } }}>
          {busy ? <Spinner size={18} /> : 'Erase and start over'}
        </button>
      </div>
    </Sheet>
  );
}

/* ── Terms (existing users on a new Terms version) ────────────────── */

export function TermsUpdate({ onAccept }: { onAccept: () => void }) {
  return (
    <Shell>
      <div className="k-onboard-top">
        <HeroSymbol><Doc size={38} stroke={1.7} /></HeroSymbol>
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
