import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Contact, Group, NodeStatus, PlainMessage, RouteHop } from '../../core/types';
import { SCENARIOS, STATUS_COPY, displayName, routeForStatus, statusForScenario } from '../../core/mock';
import type { Scenario } from '../../core/mock';
import { dayLabel, expiryLabel, fileSize, formatTime, listStamp, relativeSeen, sameDay } from '../../core/format';
import { groupedKey } from '../../core/fingerprint';
import { useStore } from '../../core/store';
import {
  Alert, ArrowRight, Check, ChevronLeft, Clock, Copy, Download, Globe, Lock as LockIcon,
  Paperclip, Plus, QR, Search, Send, Settings as SettingsIcon, Trash, Users, X,
} from '../../components/icons';
import { SEAL_COPY, SealBadge, Sender, WaxSeal, Words } from './parts';
import './tokens.css';
import './seal.css';

type View = 'stack' | 'thread' | 'group' | 'settings' | 'identity';
type Theme = 'light' | 'dark';

interface Props {
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}

export function SealApp({ scenario, onScenario }: Props) {
  const store = useStore();
  const { state } = store;
  const firstRun = scenario === 'first-run';
  const status = firstRun ? 'offline' : state.status;
  const hops = routeForStatus(status);
  const theme = state.settings.theme;
  const setTheme = (t: Theme) => store.setSettings({ theme: t });
  const [view, setView] = useState<View>('stack');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);

  /* Same as Direction A: the States explorer performs real actions on the store rather than
     faking flags, so "the seal broke" is the genuine code path. */
  useEffect(() => {
    setAcked(false);
    const cs = store.state.contacts;
    const pick = (i: number) => cs[i]?.id ?? null;
    if (scenario === 'key-changed') {
      setView('thread'); setVerifyFor(null);
      const target = cs.find((c) => c.trust === 'changed') ?? cs[1];
      if (target) {
        setOpenKey(target.id!);
        if (target.trust !== 'changed') store.rotateKey(target.id!);
      }
    }
    else if (scenario === 'verify') { setView('thread'); setOpenKey(pick(1)); setVerifyFor(pick(1)); }
    else if (scenario === 'empty-thread') { setView('thread'); setOpenKey(pick(4)); setVerifyFor(null); }
    else if (scenario === 'first-run') { setView('stack'); setOpenKey(null); setVerifyFor(null); }
    else if (scenario === 'send-failed') { setView('thread'); setOpenKey(pick(0)); setVerifyFor(null); }
    else { setVerifyFor(null); store.setStatus(statusForScenario(scenario)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSwitcher((v) => !v); }
      if (e.key === 'Escape') { setSwitcher(false); setVerifyFor(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const contacts = firstRun ? [] : state.contacts;
  const groups = firstRun ? [] : state.groups;
  const contact = useMemo(() => contacts.find((c) => c.id === openKey) ?? null, [contacts, openKey]);
  const verifyContact = verifyFor ? state.contacts.find((c) => c.id === verifyFor) ?? null : null;

  const open = (id: string) => { setOpenKey(id); setOpenGroup(null); setView('thread'); store.markRead(id); };

  if (scenario === 'loading' || !state.ready) {
    return (
      <div data-dir="seal" data-theme={theme} className="sboot">
        <WaxSeal hex={state.meHex} state="verified" size={54} />
        <span className="u-small">Unlocking your letters</span>
      </div>
    );
  }

  if (scenario === 'auth-create' || scenario === 'auth-unlock' || scenario === 'auth-error') {
    return (
      <SealAuth
        theme={theme}
        mode={scenario === 'auth-create' ? 'create' : 'unlock'}
        error={scenario === 'auth-error'}
        onDone={() => onScenario('first-run')}
      />
    );
  }

  return (
    <div className="seal" data-dir="seal" data-theme={theme}>
      <header className="seal-bar">
        {view !== 'stack' ? (
          <button className="sbtn sbtn-ghost sbtn-icon sbtn-sm" onClick={() => setView('stack')} aria-label="Back to all letters">
            <ChevronLeft size={18} />
          </button>
        ) : (
          <span className="seal-mark">
            <WaxSeal hex={state.meHex} state="verified" size={24} />
            Kant
          </span>
        )}

        <div className="seal-bar-spacer" />

        <SealStatus status={status} hops={hops} onConnect={store.connect} />

        <button className="sbtn sbtn-ghost sbtn-icon sbtn-sm" onClick={() => setSwitcher(true)} aria-label="Find a conversation">
          <Search size={17} />
        </button>
        <button
          className="sbtn sbtn-ghost sbtn-icon sbtn-sm"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
        >
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
        <button
          className="sbtn sbtn-ghost sbtn-icon sbtn-sm"
          onClick={() => setView(view === 'settings' ? 'stack' : 'settings')}
          aria-label="Settings"
          aria-pressed={view === 'settings'}
        >
          <SettingsIcon size={17} />
        </button>
      </header>

      {view === 'settings' ? (
        <SealSettings status={status} onIdentity={() => setView('identity')} />
      ) : view === 'identity' ? (
        <SealIdentity onBack={() => setView('settings')} />
      ) : view === 'thread' && contact ? (
        <SealThread
          contact={contact}
          status={status}
          scenario={scenario}
          acked={acked}
          onAck={() => setAcked(true)}
          onVerify={() => setVerifyFor(contact.id!)}
        />
      ) : view === 'group' && openGroup ? (
        <SealGroup groupId={openGroup} status={status} />
      ) : firstRun ? (
        <SealWelcome status={status} onConnect={store.connect} meHex={state.meHex} />
      ) : (
        <SealStack
          contacts={contacts}
          groups={groups}
          onOpen={open}
          onOpenGroup={(id) => { setOpenGroup(id); setOpenKey(null); setView('group'); }}
        />
      )}

      {switcher && (
        <Switcher
          onClose={() => setSwitcher(false)}
          onPick={(id) => { open(id); setSwitcher(false); }}
          onScenario={(s) => { onScenario(s); setSwitcher(false); }}
        />
      )}

      {verifyContact && <SealCeremony contact={verifyContact} onClose={() => setVerifyFor(null)} />}
    </div>
  );
}

/* ================================================================== *
 * The stack — conversations as a pile of sealed letters
 * ================================================================== */

function SealStack({
  contacts, groups, onOpen, onOpenGroup,
}: {
  contacts: Contact[];
  groups: Group[];
  onOpen: (hex: string) => void;
  onOpenGroup: (id: string) => void;
}) {
  const sorted = [...contacts].sort(
    (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0),
  );
  const unread = contacts.reduce((a, c) => a + (c.unread ?? 0), 0);

  return (
    <main className="seal-scroll">
      <div className="seal-col">
        <div style={{ marginBottom: 28 }}>
          <h1 className="d-hero">Letters</h1>
          <p className="u-small" style={{ marginTop: 4 }}>
            {unread > 0 ? `${unread} unread` : 'Nothing new'} · {contacts.length} correspondents
          </p>
        </div>

        <div className="stagger">
          {sorted.map((c) => (
            <button key={c.id} className="env" onClick={() => onOpen(c.id!)}>
              <Sender contact={c} size={44} />
              <span className="env-body">
                <span className="env-top">
                  <span className="env-name">{displayName(c)}</span>
                  {c.trust !== 'unverified' && <SealBadge state={c.trust} />}
                  {c.lastMessageTs && <span className="env-when">{listStamp(c.lastMessageTs)}</span>}
                </span>
                <span className="env-preview">
                  <span className="env-line">{c.lastMessage ?? 'No letters yet'}</span>
                  {!!c.unread && <span className="env-unread">{c.unread}</span>}
                </span>
              </span>
            </button>
          ))}

          {groups.length > 0 && (
            <div className="u-label" style={{ margin: '28px 0 10px' }}>Circles</div>
          )}
          {groups.map((g) => (
            <button key={g.id} className="env" onClick={() => onOpenGroup(g.id)}>
              <span className="sender" style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'var(--bg-sunk)' }}>
                <Users size={19} color="var(--fg-muted)" />
              </span>
              <span className="env-body">
                <span className="env-top">
                  <span className="env-name">{g.name}</span>
                  {g.lastMessageTs && <span className="env-when">{listStamp(g.lastMessageTs)}</span>}
                </span>
                <span className="env-preview">
                  <span className="env-line">{g.lastMessage}</span>
                  {!!g.unread && <span className="env-unread">{g.unread}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>

        <button className="sbtn sbtn-quiet" style={{ marginTop: 24 }}>
          <Plus size={15} /> Add a correspondent
        </button>
      </div>
    </main>
  );
}

/* ================================================================== *
 * Thread
 * ================================================================== */

function SealThread({
  contact, status, scenario, acked, onAck, onVerify,
}: {
  contact: Contact;
  status: NodeStatus;
  scenario: Scenario;
  acked: boolean;
  onAck: () => void;
  onVerify: () => void;
}) {
  const store = useStore();
  const base = store.state.threads[contact.id!] ?? [];
  const messages: PlainMessage[] = useMemo(() => {
    if (scenario !== 'send-failed') return base;
    return [...base, { id: 'f', from: 'me', ts: Date.now() - 30_000, text: 'did the cert renewal go through?', status: 'failed' }];
  }, [base, scenario]);

  const broken = contact.trust === 'changed' && !acked;
  const offline = status === 'offline' || status === 'error';

  return (
    <>
      <main className="seal-scroll">
        <div className="seal-col">
          <div className="conv-head">
            <WaxSeal hex={contact.publicKeyHex} state={contact.trust} size={48} />
            <div className="conv-who">
              <h1 className="conv-name">{displayName(contact)}</h1>
              <div className="conv-status">
                {contact.online ? 'Here now' : contact.lastSeen ? `Last here ${relativeSeen(contact.lastSeen)}` : 'Away'}
                {' · '}{SEAL_COPY[contact.trust].label.toLowerCase()}
              </div>
            </div>
            {contact.trust !== 'verified' && (
              <button className="sbtn sbtn-quiet sbtn-sm" onClick={onVerify}>Seal</button>
            )}
          </div>

          {broken && (
            <div className="notice notice-break" role="alert">
              <WaxSeal hex={contact.publicKeyHex} state="changed" size={44} />
              <div className="notice-body">
                <div className="notice-title">The seal broke</div>
                <div className="notice-text">
                  {contact.verifiedAt
                    ? `You sealed ${displayName(contact)} on ${new Date(contact.verifiedAt).toLocaleDateString([], { day: 'numeric', month: 'long' })}. `
                    : `You had sealed ${displayName(contact)}. `}
                  The key behind this conversation is not that key any more. Reinstalling or changing phone does
                  this. So does someone stepping into the middle.
                </div>
                <div className="notice-actions">
                  <button className="sbtn sbtn-break sbtn-sm" onClick={onVerify}>Compare words again</button>
                  <button className="sbtn sbtn-ghost sbtn-sm" onClick={onAck}>Later</button>
                </div>
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="sempty">
              <div className="d-sub">Nothing here yet</div>
              <p>
                {contact.circuitAddr
                  ? 'Write the first letter. It is encrypted end to end and kept only on your two devices.'
                  : `You have ${displayName(contact)}’s key but no way to reach them yet. They need to appear on a relay you can both see.`}
              </p>
            </div>
          ) : (
            <div className="thread">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showDay = !prev || !sameDay(prev.ts, m.ts);
                const mine = m.from === 'me';

                if (m.system === 'key-changed') {
                  return (
                    <div key={m.id}>
                      {showDay && <div className="daymark">{dayLabel(m.ts)}</div>}
                      <div className="sysline">
                        <WaxSeal hex={contact.publicKeyHex} state="changed" size={22} />
                        The seal broke at {formatTime(m.ts)}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.id}>
                    {showDay && <div className="daymark">{dayLabel(m.ts)}</div>}
                    <div className={`turn ${mine ? 'me' : 'them'}${m.status === 'failed' ? ' failed' : ''}`}>
                      <div className="turn-attr">
                        <span>{mine ? 'You' : displayName(contact)}</span>
                        <span>·</span>
                        <span>{formatTime(m.ts)}</span>
                        {m.expiresAt && <><Clock size={11} /><span>{expiryLabel(m.expiresAt)}</span></>}
                        {mine && m.status === 'read' && <Check size={12} color="var(--seal-intact)" />}
                      </div>
                      <div className="turn-text">
                        {m.text}
                        {m.attachments?.map((a) => (
                          <span className="attach-card" key={a.name}>
                            <Paperclip size={15} color="var(--fg-muted)" />
                            <span style={{ minWidth: 0 }}>
                              <b>{a.name}</b>
                              <span>{fileSize(a.size)}</span>
                            </span>
                            <button className="sbtn sbtn-ghost sbtn-icon sbtn-sm" aria-label={`Save ${a.name}`}>
                              <Download size={14} />
                            </button>
                          </span>
                        ))}
                      </div>
                      {m.status === 'failed' && (
                        <div className="turn-note">
                          Not delivered — no route to {displayName(contact)}. <button className="sbtn sbtn-ghost sbtn-sm" style={{ height: 22, padding: '0 6px' }}>Try again</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <SealComposer disabled={offline} name={displayName(contact)} onSend={(t) => store.send(contact.id!, t)} />
    </>
  );
}

function SealGroup({ groupId, status }: { groupId: string; status: NodeStatus }) {
  const store = useStore();
  const group = store.state.groups.find((g) => g.id === groupId);
  const messages = store.state.groupThreads[groupId] ?? [];
  if (!group) return null;

  return (
    <>
      <main className="seal-scroll">
        <div className="seal-col">
          <div className="conv-head">
            <span style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 14, background: 'var(--bg-sunk)' }}>
              <Users size={21} color="var(--fg-muted)" />
            </span>
            <div className="conv-who">
              <h1 className="conv-name">{group.name}</h1>
              <div className="conv-status">{group.memberKeys.length} people</div>
            </div>
          </div>

          <div className="thread">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showDay = !prev || !sameDay(prev.ts, m.ts);
              const mine = m.from === 'me';
              const sender = store.state.contacts.find((c) => c.publicKeyHex === m.from);
              return (
                <div key={m.id}>
                  {showDay && <div className="daymark">{dayLabel(m.ts)}</div>}
                  <div className={`turn ${mine ? 'me' : 'them'}`}>
                    <div className="turn-attr">
                      {!mine && sender && <WaxSeal hex={sender.publicKeyHex} state={sender.trust} size={16} />}
                      <span>{mine ? 'You' : sender ? displayName(sender) : 'Unknown'}</span>
                      <span>·</span>
                      <span>{formatTime(m.ts)}</span>
                      {m.expiresAt && <><Clock size={11} /><span>{expiryLabel(m.expiresAt)}</span></>}
                    </div>
                    <div className="turn-text">{m.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
      <SealComposer disabled={status === 'offline' || status === 'error'} name={group.name} />
    </>
  );
}

function SealComposer({ disabled, name, onSend }: { disabled?: boolean; name: string; onSend?: (t: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    const text = value.trim();
    if (!text || !onSend) return;
    onSend(text);
    setValue('');
  };
  return (
    <div className="scomposer">
      <div className="scomposer-inner">
        <button className="sbtn sbtn-ghost sbtn-icon sbtn-sm" aria-label="Attach a file" disabled={disabled}>
          <Paperclip size={17} />
        </button>
        <textarea
          className="scomposer-input"
          rows={1}
          value={value}
          disabled={disabled}
          aria-label={`Write to ${name}`}
          placeholder={disabled ? 'Connect to send' : `Write to ${name}…`}
          onChange={(e) => {
            setValue(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <button className="sbtn sbtn-accent sbtn-icon" aria-label="Send" disabled={disabled || !value.trim()} onClick={submit}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Welcome (first run)
 * ================================================================== */

function SealWelcome({ status, onConnect, meHex }: { status: NodeStatus; onConnect: () => void; meHex: string }) {
  const store = useStore();
  const words = store.identity(meHex)?.words ?? [];
  return (
    <main className="seal-scroll">
      <div className="seal-col anim-rise">
        <div style={{ marginBottom: 32 }}>
          <WaxSeal hex={meHex} state="verified" size={72} animate />
        </div>
        <h1 className="d-hero" style={{ marginBottom: 12 }}>This seal is yours alone</h1>
        <p className="d-read" style={{ maxWidth: '52ch', marginBottom: 36 }}>
          It was pressed from a key that exists only on this device. No account, no phone number, nothing
          held anywhere else. Show it to someone and they can write to you — and know it reached you.
        </p>

        <div className="scard" style={{ marginBottom: 14 }}>
          <div className="u-label" style={{ marginBottom: 8 }}>Step one</div>
          <div className="d-sub" style={{ marginBottom: 6 }}>Find a relay</div>
          <p className="u-body" style={{ color: 'var(--fg-muted)', marginBottom: 16 }}>
            A relay carries sealed letters between people who cannot reach each other directly. It can see that
            you and someone else exchanged something. It can never open it.
          </p>
          <button className="sbtn sbtn-primary" onClick={onConnect}>
            {status === 'offline' ? 'Connect' : 'Connected'} <ArrowRight size={15} />
          </button>
        </div>

        <div className="scard" style={{ marginBottom: 14 }}>
          <div className="u-label" style={{ marginBottom: 8 }}>Step two</div>
          <div className="d-sub" style={{ marginBottom: 6 }}>Give someone your words</div>
          <p className="u-body" style={{ color: 'var(--fg-muted)', marginBottom: 16 }}>
            These eight words are your key, in a form you can read down a phone line. Say them to someone once and
            they can seal you for good.
          </p>
          <Words words={words} />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="sbtn sbtn-quiet sbtn-sm"><Copy size={14} /> Copy key</button>
            <button className="sbtn sbtn-ghost sbtn-sm"><QR size={14} /> Show code</button>
          </div>
        </div>

        <div className="scard">
          <div className="u-label" style={{ marginBottom: 8 }}>Step three</div>
          <div className="d-sub" style={{ marginBottom: 6 }}>Write to someone</div>
          <p className="u-body" style={{ color: 'var(--fg-muted)', marginBottom: 16 }}>
            Paste their key to begin. You can compare words with them later and seal the conversation.
          </p>
          <button className="sbtn sbtn-quiet"><Plus size={15} /> Add a correspondent</button>
        </div>
      </div>
    </main>
  );
}

/* ================================================================== *
 * The ceremony
 *
 * Same two-outcome structure as Direction A — the research is the research — but the reward is
 * physical: confirming presses the seal, with the stamp animation. Rejecting says so plainly and
 * leaves the seal unpressed.
 * ================================================================== */

function SealCeremony({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const store = useStore();
  const [result, setResult] = useState<'none' | 'ok' | 'no'>('none');
  const [showRaw, setShowRaw] = useState(false);
  /* Symmetric over both identity keys — their device shows exactly these eight words. */
  const words = store.ceremonyWords(contact.id!) ?? [];

  return (
    <div className="sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Seal ${displayName(contact)}`}>
        {result === 'none' && (
          <>
            <div className="sheet-head">
              <div style={{ flex: 1 }}>
                <div className="d-title">Read these to {displayName(contact)}</div>
                <p className="u-small" style={{ marginTop: 4 }}>
                  In person, or on a call where you already know their voice. They see the same eight words on their
                  screen — it is one comparison, not two. All eight, in order, and listen to the middle ones: that is
                  where a substitution hides.
                </p>
              </div>
              <button className="sbtn sbtn-ghost sbtn-icon sbtn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="sheet-body">
              <Words words={words} />

              <button
                className="sbtn sbtn-ghost sbtn-sm"
                style={{ marginTop: 18, paddingLeft: 0 }}
                onClick={() => setShowRaw((v) => !v)}
                aria-expanded={showRaw}
              >
                {showRaw ? 'Hide the raw key' : 'Show the raw key'}
              </button>
              {showRaw && (
                <>
                  <div className="keyline" style={{ marginTop: 10 }}>{groupedKey(contact.publicKeyHex)}</div>
                  <p className="u-small" style={{ marginTop: 8 }}>
                    The words above are this key. Reading hex aloud is measurably worse at catching a swap — it is here
                    because hiding it would be dishonest, not because it is better.
                  </p>
                </>
              )}

              {contact.trust === 'changed' && (
                <div className="notice notice-break" style={{ marginTop: 20, marginBottom: 0 }}>
                  <Alert size={18} color="var(--seal-broken)" />
                  <div className="notice-body">
                    <div className="notice-title" style={{ fontSize: 17 }}>These are not the words you sealed</div>
                    <div className="notice-text">If they did not just change device, stop here and reach them another way.</div>
                  </div>
                </div>
              )}
            </div>

            <div className="sheet-foot">
              <button className="sbtn sbtn-break" onClick={() => { store.setTrust(contact.id!, 'unverified'); setResult('no'); }}>
                They don’t match
              </button>
              <div style={{ flex: 1 }} />
              <button className="sbtn sbtn-ghost" onClick={onClose}>Not now</button>
              <button className="sbtn sbtn-primary" onClick={() => { store.setTrust(contact.id!, 'verified'); setResult('ok'); }}>
                All eight match
              </button>
            </div>
          </>
        )}

        {result === 'ok' && (
          <>
            <div className="sheet-body" style={{ textAlign: 'center', padding: '48px 32px 32px' }}>
              <WaxSeal hex={contact.publicKeyHex} state="verified" size={110} animate />
              <div className="d-title" style={{ marginTop: 24, marginBottom: 8 }}>{displayName(contact)} is sealed</div>
              <p className="u-body" style={{ color: 'var(--fg-muted)', maxWidth: '38ch', margin: '0 auto' }}>
                It stays sealed until their key changes. If that happens, the seal breaks on its own and you will see it
                before you write another word.
              </p>
            </div>
            <div className="sheet-foot">
              <div style={{ flex: 1 }} />
              <button className="sbtn sbtn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}

        {result === 'no' && (
          <>
            <div className="sheet-body" style={{ textAlign: 'center', padding: '48px 32px 32px' }}>
              <WaxSeal hex={contact.publicKeyHex} state="changed" size={110} />
              <div className="d-title" style={{ marginTop: 24, marginBottom: 8 }}>Left unsealed</div>
              <p className="u-body" style={{ color: 'var(--fg-muted)', maxWidth: '42ch', margin: '0 auto' }}>
                Do not send anything you would mind a stranger reading. Reach {displayName(contact)} another way and get
                their key again — the one you have may not be theirs.
              </p>
            </div>
            <div className="sheet-foot">
              <div style={{ flex: 1 }} />
              <button className="sbtn sbtn-primary" onClick={onClose}>Understood</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Switcher
 * ================================================================== */

function Switcher({
  onClose, onPick, onScenario,
}: {
  onClose: () => void;
  onPick: (hex: string) => void;
  onScenario: (s: Scenario) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const query = q.trim().toLowerCase();
  const people = useStore().state.contacts.filter((c) => !query || (c.nickname ?? '').toLowerCase().includes(query));
  const states = SCENARIOS.filter((s) => !query || s.label.toLowerCase().includes(query));
  const total = people.length + states.length;

  const run = (i: number) => {
    if (i < people.length) onPick(people[i].id!);
    else if (states[i - people.length]) onScenario(states[i - people.length].id);
  };

  return (
    <div className="switcher-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-modal="true" aria-label="Find a conversation">
        <div className="switcher-input">
          <Search size={19} color="var(--fg-faint)" />
          <input
            ref={ref}
            value={q}
            placeholder="Who are you looking for?"
            aria-label="Search"
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, total - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); run(active); }
            }}
          />
        </div>
        <div className="switcher-list">
          {people.length > 0 && <div className="switcher-group">People</div>}
          {people.map((c, i) => (
            <button key={c.id} className="switcher-item" data-active={active === i} onMouseEnter={() => setActive(i)} onClick={() => run(i)}>
              <WaxSeal hex={c.publicKeyHex} state={c.trust} size={26} />
              <b>{displayName(c)}</b>
              <span>{SEAL_COPY[c.trust].label}</span>
            </button>
          ))}
          {states.length > 0 && <div className="switcher-group">Jump to a state</div>}
          {states.map((s, i) => {
            const idx = people.length + i;
            return (
              <button key={s.id} className="switcher-item" data-active={active === idx} onMouseEnter={() => setActive(idx)} onClick={() => run(idx)}>
                <b>{s.label}</b>
                <span>{s.group}</span>
              </button>
            );
          })}
          {total === 0 && <div style={{ padding: 28, textAlign: 'center' }} className="u-small">Nobody by that name.</div>}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Status
 * ================================================================== */

function SealStatus({ status, hops, onConnect }: { status: NodeStatus; hops: RouteHop[]; onConnect: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="sstatus" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog">
        <span className={`sdot sdot-${status}`} />
        {STATUS_COPY[status].label}
      </button>
      {open && (
        <div className="spop" role="dialog" aria-label="Connection">
          <div className="u-label" style={{ marginBottom: 8 }}>Connection</div>
          <p className="u-small" style={{ marginBottom: 14, color: 'var(--fg-body)' }}>{STATUS_COPY[status].detail}</p>
          {hops.length > 0 && (
            <>
              <div className="u-label" style={{ marginBottom: 6 }}>The path</div>
              {hops.map((h, i) => (
                <div className="hop" key={i}>
                  <span className={`sdot sdot-${h.kind === 'peer' ? 'direct' : h.kind === 'relay' ? 'relay' : 'onion'}`} />
                  <span className="mono">{h.label}</span>
                  {h.ms !== undefined && <span className="hop-ms">{h.ms}ms</span>}
                </div>
              ))}
            </>
          )}
          {(status === 'offline' || status === 'error') && (
            <button className="sbtn sbtn-primary sbtn-block sbtn-sm" style={{ marginTop: 12 }} onClick={onConnect}>Connect</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * Settings & identity
 * ================================================================== */

function SealSettings({ status, onIdentity }: { status: NodeStatus; onIdentity: () => void }) {
  const store = useStore();
  const { settings, meHex } = store.state;
  const [relay, setRelay] = useState(settings.relay);

  return (
    <main className="seal-scroll">
      <div className="seal-col">
        <h1 className="d-hero" style={{ marginBottom: 28 }}>Settings</h1>

        <div className="scard" style={{ marginBottom: 14 }}>
          <div className="d-sub" style={{ marginBottom: 14 }}>Your identity</div>
          <button className="srow" style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={onIdentity}>
            <WaxSeal hex={meHex} state="verified" size={44} />
            <span className="srow-body">
              <span className="srow-name">you</span>
              <span className="srow-desc">Your seal, words and key</span>
            </span>
            <ArrowRight size={16} color="var(--fg-faint)" />
          </button>
        </div>

        <div className="scard" style={{ marginBottom: 14 }}>
          <div className="d-sub" style={{ marginBottom: 14 }}>Reaching people</div>
          <div className="sfield" style={{ marginBottom: 16 }}>
            <label className="sfield-label" htmlFor="s-relay">Relay</label>
            <div className="sinput-wrap">
              <Globe size={16} color="var(--fg-faint)" />
              <input id="s-relay" className="sinput mono" value={relay} onChange={(e) => setRelay(e.target.value)} spellCheck={false} />
            </div>
            <span className="sfield-hint">Has to be reachable from the internet — a home network address only works at home.</span>
          </div>
          <button className="sbtn sbtn-quiet sbtn-sm" style={{ marginBottom: 8 }} onClick={() => { store.setSettings({ relay }); store.connect(); }}>
            Apply and reconnect
          </button>

          <div className="srow">
            <div className="srow-body">
              <div className="srow-name">Route through other people</div>
              <div className="srow-desc">Your letters take a longer path, reducing what an individual forwarding peer can link. Slower, needs someone else online, and does not hide relay-registry lookups.</div>
            </div>
            <button className="stoggle" role="switch" aria-checked={settings.onion} aria-label="Route through other people" onClick={() => store.setSettings({ onion: !settings.onion })} />
          </div>
        </div>

        <div className="scard" style={{ marginBottom: 14, borderColor: 'color-mix(in srgb, var(--seal-broken) 30%, transparent)' }}>
          <div className="d-sub" style={{ marginBottom: 8 }}>Erase everything</div>
          <p className="u-body" style={{ color: 'var(--fg-muted)', marginBottom: 16 }}>
            Your key, every letter and every correspondent, gone from this device. Nothing is stored anywhere else and
            there is no recovery phrase. This is final.
          </p>
          <button className="sbtn sbtn-break" onClick={store.reset}><Trash size={15} /> Erase</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 20 }}>
          <span className={`sdot sdot-${status}`} />
          <span className="u-caption">{STATUS_COPY[status].label} · Kant 2.0 prototype</span>
        </div>
      </div>
    </main>
  );
}

function SealIdentity({ onBack }: { onBack: () => void }) {
  const store = useStore();
  const meHex = store.state.meHex;
  const words = store.identity(meHex)?.words ?? [];
  const [showRaw, setShowRaw] = useState(false);
  return (
    <main className="seal-scroll">
      <div className="seal-col">
        <button className="sbtn sbtn-ghost sbtn-sm" style={{ paddingLeft: 0, marginBottom: 20 }} onClick={onBack}>
          <ChevronLeft size={16} /> Settings
        </button>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <WaxSeal hex={meHex} state="verified" size={120} />
          <h1 className="d-title" style={{ marginTop: 18 }}>you</h1>
          <p className="u-small" style={{ marginTop: 4 }}>Pressed from a key that has never left this device</p>
        </div>

        <div className="scard" style={{ marginBottom: 14 }}>
          <div className="u-label" style={{ marginBottom: 12 }}>Your key, in words</div>
          <p className="u-small" style={{ marginTop: -6, marginBottom: 12 }}>
            For sharing, so someone can add you. Not the value you compare when sealing — that one belongs to a
            conversation, not to a person.
          </p>
          <Words words={words} />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="sbtn sbtn-quiet sbtn-sm"><Copy size={14} /> Copy key</button>
            <button className="sbtn sbtn-ghost sbtn-sm"><QR size={14} /> Show code</button>
          </div>
        </div>

        <div className="scard">
          <div className="srow" style={{ paddingTop: 0 }}>
            <div className="srow-body">
              <div className="srow-name">Raw key</div>
              <div className="srow-desc">Ed25519, hex</div>
            </div>
            <button className="sbtn sbtn-ghost sbtn-sm" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}>
              {showRaw ? 'Hide' : 'Show'}
            </button>
          </div>
          {showRaw && <div className="keyline">{groupedKey(meHex)}</div>}
        </div>
      </div>
    </main>
  );
}

/* ================================================================== *
 * Auth
 * ================================================================== */

function SealAuth({
  theme, mode, error, onDone,
}: {
  theme: Theme; mode: 'create' | 'unlock'; error?: boolean; onDone: () => void;
}) {
  const meHex = useStore().state.meHex;
  const [pw, setPw] = useState(error ? 'hunter2' : '');
  const [pw2, setPw2] = useState('');
  const create = mode === 'create';

  return (
    <div data-dir="seal" data-theme={theme} className="sauth">
      <div className="sauth-card anim-rise">
        <div style={{ marginBottom: 28 }}>
          <WaxSeal hex={meHex} state={create ? 'unverified' : 'verified'} size={64} animate={!create} />
        </div>

        <h1 className="d-hero" style={{ marginBottom: 12 }}>
          {create ? 'Press your seal' : 'Welcome back'}
        </h1>
        <p className="d-read" style={{ color: 'var(--fg-muted)', marginBottom: 32 }}>
          {create
            ? 'A key is made here, on this device, and locked with a password only you know. Nothing is sent anywhere. If you forget the password, nobody — including us — can get it back.'
            : 'Your key is locked on this device.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="sfield">
            <label className="sfield-label" htmlFor="s-pw">Password</label>
            <div className={`sinput-wrap${error ? ' is-error' : ''}`}>
              <LockIcon size={16} color="var(--fg-faint)" />
              <input
                id="s-pw"
                className="sinput"
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={create ? 'At least 8 characters' : 'Your password'}
              />
            </div>
            {error && <span className="sfield-error">That password does not open this key.</span>}
          </div>

          {create && (
            <div className="sfield">
              <label className="sfield-label" htmlFor="s-pw2">Again</label>
              <div className="sinput-wrap">
                <LockIcon size={16} color="var(--fg-faint)" />
                <input id="s-pw2" className="sinput" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Type it once more" />
              </div>
            </div>
          )}

          <button className="sbtn sbtn-primary sbtn-lg sbtn-block" onClick={onDone}>
            {create ? 'Create my key' : 'Unlock'}
          </button>
        </div>

        <p className="u-caption" style={{ marginTop: 24 }}>
          No account. No phone number. Nothing stored on a server.
        </p>
      </div>
    </div>
  );
}

/* ---------------- small icons local to this direction ---------------- */

function MoonIcon(): ReactNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SunIcon(): ReactNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
