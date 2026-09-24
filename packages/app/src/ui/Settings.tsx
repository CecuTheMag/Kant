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
  Doc, Link as LinkIcon, Bubble,
} from './icons';
import { copyText, normalizeRelayUrl, shortId } from './lib';
import { Avatar, Cell, Confirm, Section, Segmented, Sheet, SheetHead, Switch, useToast } from './parts';
import { BlockedSheet } from './sheets';

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
