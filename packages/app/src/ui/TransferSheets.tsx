/**
 * Settings → Backup and moving: save an encrypted backup file, or move the
 * account to a new phone (scan its code, compare the 6-digit code, send,
 * then this device erases itself).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from './core/store';
import { Alert, Check, Doc, Refresh, Spinner } from './icons';
import { QrScanner } from './Scanner';
import { Section, Segmented, Sheet, SheetHead, SheetHero, Switch, useToast } from './parts';
import { isTouch } from './lib';

function Close({ onClick, label = 'Cancel' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="k-btn k-btn-plain" onClick={onClick}>{label}</button>;
}

export function BackupSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [includeFiles, setIncludeFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const bytes = await store.transfer.createBackup(password, includeFiles);
      const day = new Date().toISOString().slice(0, 10);
      const ok = await store.saveFile(`kant-backup-${day}.kantbackup`, 'application/octet-stream', bytes);
      if (ok) { toast('Backup saved', <Check size={18} />); onClose(); }
      else setError('Couldn’t save the file.');
    } catch (e) {
      setError((e as Error)?.message === 'WRONG_PASSWORD' ? 'That’s not your password.' : 'Couldn’t create the backup.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label="Save a backup" tall>
      <SheetHead left={<Close onClick={onClose} />} title="Save a backup" />
      <div className="k-sheet-body">
        <SheetHero icon={<Doc size={30} />} title="An encrypted backup">
          One file with your identity, contacts and messages. Anyone with the file <b>and</b> your password can become you — keep it somewhere safe.
        </SheetHero>
        <Section foot={<>To restore it, choose <b>I already use Kant</b> → <b>Restore a backup</b> when setting up Kant.</>}>
          <div className="k-cell">
            <span className="k-cell-body"><span className="k-cell-label">Include photos and files</span><span className="k-cell-sub">Makes the backup larger</span></span>
            <Switch label="Include photos and files" checked={includeFiles} onChange={setIncludeFiles} />
          </div>
          <div className="k-cell">
            <input className="k-cell-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password" aria-label="Your password" autoComplete="current-password" />
          </div>
        </Section>
        {error && <p className="k-error k-sheet-error" role="alert"><Alert size={16} />{error}</p>}
      </div>
      <div className="k-sheet-foot">
        <button type="button" className="k-btn k-btn-primary k-btn-block" disabled={busy || !password} onClick={() => { void save(); }}>
          {busy ? <><Spinner size={18} /> Encrypting…</> : 'Save backup'}
        </button>
      </div>
    </Sheet>
  );
}

function moveError(e: unknown): string {
  switch ((e as Error)?.message) {
    case 'BAD_CODE': return 'That isn’t a move code. On the new phone choose “Move from your other phone” to get one.';
    case 'OFFLINE': return 'You’re offline. Connect first, then try again.';
    case 'DECLINED': return 'The new phone said the codes didn’t match, so nothing was sent.';
    case 'BAD_PEER': return 'The new phone couldn’t be verified, so nothing was sent.';
    default: return 'The move didn’t finish. Everything is still on this phone — try again.';
  }
}

export function MoveOutSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [phase, setPhase] = useState<'intro' | 'scan' | 'connecting' | 'compare' | 'sending' | 'done' | 'error'>('intro');
  const [mode, setMode] = useState<'scan' | 'paste'>(isTouch() ? 'scan' : 'paste');
  const [text, setText] = useState('');
  const [sas, setSas] = useState('');
  const [pieces, setPieces] = useState(0);
  const [error, setError] = useState('');
  const running = useRef(false);

  const start = async (code: string) => {
    if (running.current) return;
    running.current = true;
    setPhase('connecting');
    setError('');
    try {
      await store.transfer.sendMove(code, {
        onSas: (s) => { setSas(s); setPhase('compare'); },
        onProgress: (n) => { setPieces(n); setPhase('sending'); },
      });
      setPhase('done');
    } catch (e) {
      setError(moveError(e));
      setPhase('error');
    } finally {
      running.current = false;
    }
  };

  // Once the new phone has everything, this one must not keep using the same sessions.
  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => { void store.transfer.finishMove(); }, 3000);
    return () => clearTimeout(t);
  }, [phase, store.transfer]);

  const busy = phase === 'connecting' || phase === 'compare' || phase === 'sending' || phase === 'done';
  return (
    <Sheet onClose={busy ? () => {} : onClose} label="Move to a new phone" tall>
      <SheetHead left={busy ? undefined : <Close onClick={onClose} />} title="Move to a new phone" />
      <div className="k-sheet-body">
        <div className="k-sheet-pad">
          {phase === 'intro' && (
            <div className="k-sheet-unpad">
              <SheetHero icon={<Refresh size={30} />} tone="ok" title="Bring everything with you">
                Everything moves directly to the new phone, end-to-end encrypted. <b>When it’s done, this phone is erased</b> — the same account can’t run on two phones.
              </SheetHero>
              <Section>
                {[
                  <>On the new phone, install Kant and choose <b>I already use Kant</b> → <b>Move from your other phone</b>.</>,
                  <>Scan the code it shows.</>,
                  <>Check both phones show the same 6 digits, and confirm on the new one.</>,
                ].map((step, i) => (
                  <div key={i} className="k-cell k-step"><span className="k-step-n">{i + 1}</span><span className="k-cell-body">{step}</span></div>
                ))}
              </Section>
              <div className="k-sheet-pad">
                <button type="button" className="k-btn k-btn-primary k-btn-block" onClick={() => setPhase('scan')}>Continue</button>
              </div>
            </div>
          )}
          {phase === 'scan' && (
            <>
              <Segmented label="How to enter the code" value={mode} onChange={setMode}
                options={[{ value: 'scan', label: 'Scan code' }, { value: 'paste', label: 'Paste code' }]} />
              <div style={{ marginTop: 14 }}>
                {mode === 'scan' ? (
                  <QrScanner onResult={(t) => { if (t.includes('kant-move:')) void start(t); }} />
                ) : (
                  <>
                    <textarea className="k-field k-mono" style={{ fontSize: 13, minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)}
                      placeholder="kant-move:1:…" aria-label="Move code" spellCheck={false} autoCapitalize="off" />
                    <button type="button" className="k-btn k-btn-primary k-btn-block" style={{ marginTop: 10 }} disabled={!text.trim()}
                      onClick={() => { void start(text.trim()); }}>Connect</button>
                  </>
                )}
              </div>
            </>
          )}
          {phase === 'connecting' && <p className="k-center"><Spinner size={22} /><br />Connecting to your new phone…</p>}
          {phase === 'compare' && (
            <div className="k-center">
              <p>Your new phone should show this code:</p>
              <div className="k-sas">{sas.slice(0, 3)} {sas.slice(3)}</div>
              <p className="k-footnote k-muted"><Spinner size={14} /> Waiting for you to confirm on the new phone. If the codes differ, choose “They don’t match” there.</p>
            </div>
          )}
          {phase === 'sending' && <p className="k-center"><Spinner size={22} /><br />Sending… {pieces} parts<br /><span className="k-footnote k-muted">Keep both phones open.</span></p>}
          {phase === 'done' && (
            <div className="k-center">
              <div className="k-result-icon ok" style={{ width: 64, height: 64, margin: '0 auto 12px' }}><Check size={30} /></div>
              <h2 className="k-title-2">Moved</h2>
              <p>Your account is on your new phone now. This phone is being erased.</p>
            </div>
          )}
          {phase === 'error' && (
            <>
              <p className="k-error" role="alert"><Alert size={16} />{error}</p>
              <button type="button" className="k-btn k-btn-primary k-btn-block" onClick={() => setPhase('scan')}>Try again</button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
