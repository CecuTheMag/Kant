/**
 * Settings — a grouped list in the iOS style. Everyday choices up top; the
 * network and diagnostics live under Advanced where nobody trips over them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getRelayInfo } from '@kant/core';
import { useStore } from './core/store';
import type { NodeStatus } from './core/types';
import { ensureNotificationPermission, getNotificationPermission } from '../lib/localNotify';
import { isBackgroundServiceRunning, isBatteryOptimized, openBatterySettings } from '../lib/backgroundService';
import {
  Alert, Bell, Block, Check, ChevronLeft, Copy, Globe, Moon, Onion, QR, Refresh, Shield, Spinner, Trash, Wave,
  Doc, Link as LinkIcon, Bubble, Fingerprint, Lock, ShieldAlert,
} from './icons';
import { copyText, normalizeRelayUrl, shortId } from './lib';
import { Avatar, Cell, Confirm, Section, Segmented, Sheet, SheetHead, Switch, useToast } from './parts';
import { BlockedSheet } from './sheets';
import { setChatPrefs, useChatPrefs } from './chat/prefs';
import { BackupSheet, MoveOutSheet } from './TransferSheets';
import { QUICK_REACTIONS } from './chat/chatLogic';
import { biometricText, readSecurityPrefs, writeSecurityPrefs } from '../lib/biometric';
import { AUTO_LOCK_CHOICES, PASSWORD_EVERY_CHOICES } from '../lib/securityPolicy';
import type { SecurityPrefs } from '../lib/securityPolicy';

declare const __KANT_VERSION__: string;

export const STATUS_TEXT: Record<NodeStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | '' }> = {
  relay: { label: 'Connected', tone: 'ok' },
  direct: { label: 'Connected', tone: 'ok' },
  onion: { label: 'Connected privately', tone: 'ok' },
  connecting: { label: 'Connecting…', tone: 'warn' },
  offline: { label: 'Offline', tone: '' },
  error: { label: 'Can’t connect', tone: 'bad' },
};

export function SettingsPane({ onBack, onMyCode, showBack }: { onBack: () => void; onMyCode: () => void; showBack: boolean }) {
  const store = useStore();
  const { state } = store;
  const toast = useToast();
  const { settings, meHex, status } = state;
  const [sheet, setSheet] = useState<'relay' | 'diagnostics' | 'blocked' | 'erase' | 'name' | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [transferSheet, setTransferSheet] = useState<'backup' | 'move' | null>(null);
  const blockedCount = state.contacts.filter((c) => c.blocked).length;
  const relayHost = (() => { try { return new URL(settings.relay).host; } catch { return settings.relay; } })();
  const st = STATUS_TEXT[status];

  return (
    <div className="k-pane">
      <header className={`k-bar${scrolled ? ' is-lined' : ''}`}>
        {showBack && <button type="button" className="k-back" onClick={onBack} aria-label="Back"><ChevronLeft size={26} /> Chats</button>}
        <div className={`k-bar-title${scrolled ? ' is-shown' : ''}`}>Settings</div>
      </header>
      <div className="k-scroll" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}>
        <div className="k-grouped">
          <h1 className="k-large-title" style={{ margin: '0 20px 16px' }}>Settings</h1>

          <Section>
            <button type="button" className="k-cell" style={{ padding: '14px 16px' }} onClick={() => setSheet('name')}>
              <Avatar name={settings.profileName} seed={meHex} size={60} />
              <span className="k-cell-body">
                <span className="k-cell-label" style={{ fontSize: 20, fontWeight: 600 }}>{settings.profileName || 'Add your name'}</span>
                <span className="k-cell-sub">{shortId(meHex)} · Only shared in your invite link</span>
              </span>
            </button>
            <Cell icon={<QR size={18} />} iconTone="indigo" label="My code" sub="Let friends add you" chevron onClick={onMyCode} />
          </Section>

          <DeliveryHealth />

          <Section title="Appearance" icons>
            <div className="k-cell">
              <span className="k-cell-icon gray"><Moon size={17} /></span>
              <span className="k-cell-body"><span className="k-cell-label">Theme</span></span>
              <Segmented label="Theme" value={settings.theme} onChange={(theme) => store.setSettings({ theme })}
                options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </div>
          </Section>

          <ChatSettings />

          <SecuritySection />

          <Section title="Backup and moving" icons foot="Backups and moves are end-to-end encrypted. Nothing passes through a server in readable form.">
            <Cell icon={<Doc size={18} />} iconTone="blue" label="Save an encrypted backup" chevron onClick={() => setTransferSheet('backup')} />
            <Cell icon={<Refresh size={18} />} iconTone="green" label="Move to a new phone" chevron onClick={() => setTransferSheet('move')} />
          </Section>
          {transferSheet === 'backup' && <BackupSheet onClose={() => setTransferSheet(null)} />}
          {transferSheet === 'move' && <MoveOutSheet onClose={() => setTransferSheet(null)} />}

          <Section title="Privacy" icons foot="Extra privacy sends messages through other people’s devices first, so the relay can’t see who you’re talking to. It’s slower and needs other people online.">
            <div className="k-cell">
              <span className="k-cell-icon purple"><Onion size={18} /></span>
              <span className="k-cell-body"><span className="k-cell-label">Extra privacy</span><span className="k-cell-sub">Onion routing</span></span>
              <Switch label="Extra privacy" checked={settings.onion} onChange={(onion) => store.setSettings({ onion })} />
            </div>
            <Cell icon={<Block size={18} />} iconTone="red" label="Blocked" value={blockedCount ? String(blockedCount) : 'None'} chevron onClick={() => setSheet('blocked')} />
          </Section>

          <Section title="Network" icons>
            <div className="k-cell">
              <span className="k-cell-icon green"><Wave size={18} /></span>
              <span className="k-cell-body"><span className="k-cell-label">Status</span></span>
              <span className={`k-cell-dot ${st.tone}`} />
              <span className="k-cell-value" style={{ maxWidth: 'none' }}>{st.label}</span>
            </div>
            <Cell icon={<Globe size={18} />} iconTone="teal" label="Relay" value={relayHost} chevron onClick={() => setSheet('relay')} />
            <Cell icon={<Doc size={17} />} iconTone="gray" label="Diagnostics" chevron onClick={() => setSheet('diagnostics')} />
          </Section>

          <Section title="About" icons>
            <Cell icon={<Shield size={17} />} iconTone="gray" label="How Kant protects you" href="https://kant.network/security" chevron />
            <Cell icon={<Doc size={17} />} iconTone="gray" label="Terms of Service" href="https://kant.network/terms" chevron />
            <Cell icon={<Bubble size={17} />} iconTone="indigo" label="Help & community" href="https://discord.gg/kdn2tAPtRX" chevron />
            <Cell icon={<LinkIcon size={17} />} iconTone="gray" label="Source code" href="https://github.com/CecuTheMag/Kant" chevron />
          </Section>

          <Section foot="Deletes your identity, contacts and messages from this device. There’s no backup and it can’t be undone.">
            <Cell label="Erase this device" tone="center-danger" onClick={() => setSheet('erase')} />
          </Section>

          <p className="k-footnote k-muted k-center" style={{ marginTop: -8 }}>
            Kant {typeof __KANT_VERSION__ === 'string' ? __KANT_VERSION__ : ''} · End-to-end encrypted
          </p>
        </div>
      </div>

      {sheet === 'name' && <NameSheet onClose={() => setSheet(null)} />}
      {sheet === 'relay' && <RelaySheet onClose={() => setSheet(null)} />}
      {sheet === 'diagnostics' && <DiagnosticsSheet onClose={() => setSheet(null)} />}
      {sheet === 'blocked' && <BlockedSheet onClose={() => setSheet(null)} />}
      {sheet === 'erase' && (
        <Confirm title="Erase this device?" danger confirmLabel="Erase everything"
          message="Your identity, contacts and all messages on this device will be permanently deleted. People will need your new code to reach you."
          onConfirm={() => { toast('Erasing…', <Trash size={18} />); store.reset(); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

/* ── Name ─────────────────────────────────────────────────────────── */

function NameSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState(store.state.settings.profileName);
  const save = () => { store.setSettings({ profileName: name }); onClose(); };
  return (
    <Sheet onClose={onClose} label="Your name">
      <SheetHead left={<button type="button" className="k-btn k-btn-plain" onClick={onClose}>Cancel</button>} title="Your name"
        right={<button type="button" className="k-btn k-btn-plain is-bold" onClick={save}>Done</button>} />
      <div className="k-sheet-body">
        <div className="k-sheet-hero"><Avatar name={name} seed={store.state.meHex} size={80} /></div>
        <Section foot="Your name is only included in the invite link you share. It’s never sent to a server.">
          <div className="k-cell">
            <input className="k-cell-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              maxLength={40} data-autofocus onKeyDown={(e) => { if (e.key === 'Enter') save(); }} aria-label="Your name" />
          </div>
        </Section>
      </div>
    </Sheet>
  );
}

/* ── Relay ────────────────────────────────────────────────────────── */

function RelaySheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const { settings, status, circuitAddr } = store.state;
  const [value, setValue] = useState(settings.relay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = value.trim().replace(/\/$/, '') !== settings.relay;

  const apply = async () => {
    const url = normalizeRelayUrl(value);
    setBusy(true);
    setError('');
    try {
      const info = await getRelayInfo(undefined, url);
      if (!info?.peerId) throw new Error('bad relay');
      store.setSettings({ relay: url });
      toast('Reconnecting…', <Refresh size={18} />);
      onClose();
    } catch {
      setError('Couldn’t reach that relay.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet onClose={onClose} label="Relay" tall>
      <SheetHead left={<button type="button" className="k-btn k-btn-plain" onClick={onClose}>Cancel</button>} title="Relay"
        right={<button type="button" className="k-btn k-btn-plain is-bold" disabled={busy || !changed} onClick={apply}>{busy ? <Spinner size={18} /> : 'Save'}</button>} />
      <div className="k-sheet-body">
        <Section title="Relay address" foot="The relay helps devices reach each other. It only ever sees encrypted data and keeps no messages. Everyone you talk to should use a relay they can reach.">
          <div className="k-cell">
            <input className="k-cell-input k-mono" style={{ fontSize: 15 }} value={value} onChange={(e) => setValue(e.target.value)}
              autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" aria-label="Relay address" />
          </div>
        </Section>
        {error && <p className="k-error" style={{ margin: '-16px 32px 20px' }}><Alert size={16} />{error}</p>}
        <Section>
          <Cell label="Reconnect now" tone="action" onClick={() => {
            store.disconnect();
            window.setTimeout(() => store.connect(), 800);
            toast('Reconnecting…', <Refresh size={18} />);
          }} />
        </Section>
        <Section title="This device" foot="Your address changes whenever you reconnect. Kant keeps contacts up to date automatically.">
          <Cell label="Status" value={STATUS_TEXT[status].label} />
          <Cell label="Your address" value={circuitAddr ? 'Copy' : 'Not connected'} tone={circuitAddr ? 'action' : undefined}
            onClick={circuitAddr ? () => { void copyText(circuitAddr); toast('Address copied', <Copy size={18} />); } : undefined} />
        </Section>
      </div>
    </Sheet>
  );
}

/* ── Diagnostics ──────────────────────────────────────────────────── */

function DiagnosticsSheet({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const text = state.debugLog.join('\n');
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [state.debugLog.length]);
  return (
    <Sheet onClose={onClose} label="Diagnostics" tall>
      <SheetHead left={<button type="button" className="k-btn k-btn-plain" onClick={() => { void copyText(text); toast('Logs copied', <Check size={18} />); }}>Copy</button>}
        title="Diagnostics" right={<button type="button" className="k-btn k-btn-plain is-bold" onClick={onClose}>Done</button>} />
      <div className="k-sheet-body">
        <Section title="Summary">
          <Cell label="Status" value={STATUS_TEXT[state.status].label} />
          <Cell label="Peers seen" value={String(state.peers.length)} />
          <Cell label="Events" value={String(state.debugLog.length)} />
        </Section>
        <div className="k-sheet-pad">
          <h2 className="k-section-title" style={{ margin: '0 0 7px' }}>Live log</h2>
          <div className="k-log" role="log" aria-live="polite">
            {state.debugLog.length === 0 ? 'No events yet.' : state.debugLog.map((line, i) => (
              <div key={i}><span>{String(i + 1).padStart(3, '0')}</span>{line}</div>
            ))}
            <div ref={endRef} />
          </div>
          <p className="k-section-foot" style={{ margin: '8px 4px 0' }}>Logs stay on this device. Copy them if someone helping you asks.</p>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Android delivery health ──────────────────────────────────────── */

/**
 * On Android three things must hold for messages to reach a closed app, and
 * each fails silently: notification permission, the background connection,
 * and a battery-optimisation exemption. Show them plainly with the one action
 * that fixes each.
 */
function DeliveryHealth() {
  const [health, setHealth] = useState<{ notifications: boolean; background: boolean; batteryRestricted: boolean } | null>(null);
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const isIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

  const refresh = useCallback(async () => {
    const [notifications, background, batteryRestricted] = await Promise.all([
      getNotificationPermission(), isBackgroundServiceRunning(), isBatteryOptimized(),
    ]);
    setHealth({ notifications, background, batteryRestricted });
  }, []);

  useEffect(() => {
    if (!isAndroid) return;
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isAndroid, refresh]);

  if (isIos) return <IosDeliveryNote />;
  if (!isAndroid || !health) return null;
  const allGood = health.notifications && health.background && !health.batteryRestricted;

  return (
    <Section title="Notifications" icons foot={allGood
      ? 'All set — Kant can reach you while it’s closed. Swiping Kant away in the app switcher disconnects it until you open it again.'
      : 'Fix the items above so messages keep arriving when Kant isn’t open.'}>
      <HealthRow ok={health.notifications} icon={<Bell size={18} />} tone="red" label="Notifications"
        okText="Allowed" badText="Turned off" action="Allow" onAction={async () => { await ensureNotificationPermission(); void refresh(); }} />
      <HealthRow ok={health.background} icon={<Wave size={18} />} tone="green" label="Background connection"
        okText="Running" badText="Starts when you connect" />
      <HealthRow ok={!health.batteryRestricted} icon={<Refresh size={17} />} tone="orange" label="Battery"
        okText="Unrestricted" badText="Restricted" action="Change" onAction={openBatterySettings} />
    </Section>
  );
}

/**
 * iPhone: Kant is paused moments after you leave it, and push notifications
 * need an Apple developer account, so say plainly when messages arrive.
 */
function IosDeliveryNote() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const refresh = useCallback(() => { void getNotificationPermission().then(setAllowed); }, []);
  useEffect(refresh, [refresh]);
  if (allowed === null) return null;
  return (
    <Section title="Notifications" icons foot="iPhone pauses Kant a few seconds after you leave it. Messages sent to you meanwhile wait on the sender’s phone and arrive as soon as you open Kant again.">
      <HealthRow ok={allowed} icon={<Bell size={18} />} tone="red" label="Notifications"
        okText="Allowed" badText="Turned off" action="Allow" onAction={async () => { await ensureNotificationPermission(); refresh(); }} />
    </Section>
  );
}

function HealthRow({ ok, icon, tone, label, okText, badText, action, onAction }: {
  ok: boolean; icon: React.ReactNode; tone: string; label: string; okText: string; badText: string;
  action?: string; onAction?: () => void | Promise<void>;
}) {
  return (
    <div className="k-cell">
      <span className={`k-cell-icon ${tone}`}>{icon}</span>
      <span className="k-cell-body"><span className="k-cell-label">{label}</span><span className="k-cell-sub">{ok ? okText : badText}</span></span>
      {ok ? <Check size={20} style={{ color: 'var(--ok)' }} />
        : action && onAction ? <button type="button" className="k-btn k-btn-secondary k-btn-sm k-btn-pill" onClick={() => void onAction()}>{action}</button>
          : <Alert size={20} style={{ color: 'var(--warn)' }} />}
    </div>
  );
}

/** Settings → Chats. Device-local; nothing here is sent to anyone. */
function ChatSettings() {
  const prefs = useChatPrefs();
  const row = (label: string, sub: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className="k-cell">
      <span className="k-cell-body"><span className="k-cell-label">{label}</span><span className="k-cell-sub">{sub}</span></span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
  return (
    <Section title="Chats" foot="Formatting: **bold**, _italic_, ~~strikethrough~~, `code`, > quotes and - lists. Select text while typing for the formatting bar, or use Ctrl/⌘ + B, I, E and Ctrl/⌘ + Shift + X.">
      {row('Show formatting', 'Bold, lists, code and links in messages', prefs.formatting, (formatting) => setChatPrefs({ formatting }))}
      {row('Formatting bar', 'When you select text in a message you’re writing', prefs.formatBar, (formatBar) => setChatPrefs({ formatBar }))}
      {row('Swipe to reply', 'Drag a message to the right', prefs.swipeReply, (swipeReply) => setChatPrefs({ swipeReply }))}
      {row('Double-tap to react', `Adds ${prefs.quickReaction}`, prefs.doubleTapReact, (doubleTapReact) => setChatPrefs({ doubleTapReact }))}
      {prefs.doubleTapReact && (
        <div className="k-cell">
          <span className="k-cell-body"><span className="k-cell-label">Quick reaction</span></span>
          <Segmented label="Quick reaction" value={prefs.quickReaction} onChange={(quickReaction) => setChatPrefs({ quickReaction })}
            options={QUICK_REACTIONS.map((e) => ({ value: e, label: e }))} />
        </div>
      )}
      {row('Ask before opening links', 'Websites see your IP address', prefs.confirmLinks, (confirmLinks) => setChatPrefs({ confirmLinks }))}
    </Section>
  );
}

/* ── Security ─────────────────────────────────────────────────────── */

const AUTO_LOCK_LABELS: Record<number, string> = { 0: 'Never', 60000: '1 min', 300000: '5 min', 900000: '15 min', 3600000: '1 h' };
const PASSWORD_EVERY_LABELS: Record<number, string> = { 86400000: 'Daily', 259200000: '3 days', 604800000: 'Weekly' };

function SecuritySection() {
  const store = useStore();
  const toast = useToast();
  const [prefs, setPrefsState] = useState<SecurityPrefs>(readSecurityPrefs);
  const [bio, setBio] = useState<{ supported: boolean; available: boolean; reason: string; enrolled: boolean } | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [duressSet, setDuressSet] = useState<boolean | null>(null);
  const [duressSheet, setDuressSheet] = useState(false);

  const refresh = useCallback(() => {
    void store.security.biometric().then(setBio).catch(() => setBio(null));
    void store.security.duressIsSet().then(setDuressSet).catch(() => setDuressSet(null));
  }, [store.security]);
  useEffect(refresh, [refresh]);

  const setPrefs = (patch: Partial<SecurityPrefs>) => {
    const next = { ...prefs, ...patch };
    writeSecurityPrefs(next);
    setPrefsState(next);
  };

  const toggleBio = async (on: boolean) => {
    setBioBusy(true);
    try {
      const error = await store.security.setBiometric(on);
      if (error && error !== 'cancelled') toast(error, <Alert size={18} />);
      else if (!error) toast(`${biometricText().Name} unlock is ${on ? 'on' : 'off'}`, <Check size={18} />);
    } finally {
      setBioBusy(false);
      refresh();
    }
  };

  const bioWords = biometricText();
  const bioRow = bio?.supported && (
    <div className="k-cell">
      <span className="k-cell-icon green"><Fingerprint size={18} /></span>
      <span className="k-cell-body">
        <span className="k-cell-label">Unlock with {bioWords.name}</span>
        <span className="k-cell-sub">{bio.available ? 'Your password is still asked for after a restart'
          : bio.reason === 'not-enrolled' ? bioWords.setupHint : 'Not available on this device'}</span>
      </span>
      {bioBusy ? <Spinner size={18} />
        : <Switch label={`Unlock with ${bioWords.name}`} checked={bio.enrolled} disabled={!bio.available && !bio.enrolled} onChange={(on) => { void toggleBio(on); }} />}
    </div>
  );

  return (
    <>
      <Section title="Security" icons foot={<>
        While Kant is locked it’s offline: messages wait on the sender’s device and arrive when you unlock.
        {bio?.enrolled && <> {bioWords.risk}</>}
      </>}>
        {bioRow}
        {bio?.enrolled && (
          <div className="k-cell">
            <span className="k-cell-body"><span className="k-cell-label">Ask for password</span></span>
            <Segmented label="Ask for password" value={String(prefs.passwordEveryMs)}
              onChange={(v) => setPrefs({ passwordEveryMs: Number(v) })}
              options={PASSWORD_EVERY_CHOICES.map((ms) => ({ value: String(ms), label: PASSWORD_EVERY_LABELS[ms] }))} />
          </div>
        )}
        <div className="k-cell">
          <span className="k-cell-icon gray"><Lock size={17} /></span>
          <span className="k-cell-body"><span className="k-cell-label">Auto-lock</span><span className="k-cell-sub">After this long in the background</span></span>
        </div>
        <div className="k-cell" style={{ paddingTop: 0 }}>
          <div className="k-seg-full">
            <Segmented label="Auto-lock" value={String(prefs.autoLockMs)} onChange={(v) => setPrefs({ autoLockMs: Number(v) })}
              options={AUTO_LOCK_CHOICES.map((ms) => ({ value: String(ms), label: AUTO_LOCK_LABELS[ms] }))} />
          </div>
        </div>
        <Cell icon={<ShieldAlert size={18} />} iconTone="red" label="Duress password"
          value={duressSet === null ? '' : duressSet ? 'On' : 'Off'} chevron onClick={() => setDuressSheet(true)} />
        <Cell icon={<Lock size={18} />} iconTone="indigo" label="Lock now" tone="action" onClick={() => store.security.lockNow()} />
      </Section>
      {duressSheet && (
        <DuressSheet isSet={!!duressSet} onClose={() => { setDuressSheet(false); refresh(); }} />
      )}
    </>
  );
}

function DuressSheet({ isSet, onClose }: { isSet: boolean; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [duress, setDuress] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (remove: boolean) => {
    setError('');
    if (!remove) {
      if (duress.length < 8) { setError('Use at least 8 characters.'); return; }
      if (duress !== confirm) { setError('The two duress passwords don’t match.'); return; }
    }
    if (!current) { setError('Enter your current password.'); return; }
    setBusy(true);
    try {
      const result = await store.security.setDuress(current, remove ? null : duress);
      if (result === 'ok') {
        toast(remove ? 'Duress password removed' : 'Duress password set', <Check size={18} />);
        onClose();
      } else {
        setError(result === 'wrong-password' ? 'That’s not your current password.'
          : result === 'same' ? 'The duress password must be different from your password.'
          : 'Couldn’t save. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, auto: string) => (
    <input className="k-field" type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label}
      aria-label={label} autoComplete={auto} style={{ marginBottom: 10 }} />
  );

  return (
    <Sheet onClose={onClose} label="Duress password" tall>
      <SheetHead left={<button type="button" className="k-btn k-btn-plain" onClick={onClose}>Cancel</button>} title="Duress password" />
      <div className="k-sheet-body">
        <div className="k-sheet-pad">
          <p className="k-footnote" style={{ marginBottom: 16 }}>
            If someone forces you to unlock Kant, type this instead of your password. Kant silently erases everything on this
            device — identity, contacts, messages, files — and opens a new, empty account that works normally. Nothing erased
            can be recovered, and nothing on the device shows that a duress password was set.
          </p>
          {field(isSet ? 'New duress password' : 'Duress password', duress, setDuress, 'new-password')}
          {field('Repeat duress password', confirm, setConfirm, 'new-password')}
          {field('Your current password', current, setCurrent, 'current-password')}
          {error && <p className="k-error" role="alert"><Alert size={16} />{error}</p>}
          <button type="button" className="k-btn k-btn-primary k-btn-block" disabled={busy} onClick={() => { void save(false); }}>
            {busy ? <Spinner size={18} /> : isSet ? 'Change duress password' : 'Set duress password'}
          </button>
          {isSet && (
            <button type="button" className="k-btn k-btn-plain k-btn-block is-danger-text" disabled={busy} style={{ marginTop: 8 }}
              onClick={() => { void save(true); }}>Turn off duress password</button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
