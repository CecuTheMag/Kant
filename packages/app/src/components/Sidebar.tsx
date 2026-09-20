import { useState } from 'react';
import type { Contact, UnlockedIdentity, DiscoveredPeer, Group } from '@kant/core';
import type { NodeStatus } from '../hooks/useKant';
import { ContactList } from './ContactList';
import { AddContactModal } from './AddContactModal';
import { GroupList } from './GroupList';
import { RelaySettings } from './RelaySettings';
import { AiSettings } from './AiSettings';
import { copyToClipboard } from '../lib/clipboard';
import type { AiSettings as AiSettingsT } from '../lib/aiClient';
import { Spinner, X } from './icons';

interface Props {
  identity: UnlockedIdentity | null;
  contacts: Contact[];
  selectedContact: Contact | null;
  nodeStatus: NodeStatus;
  circuitAddr: string;
  discoveredPeers: DiscoveredPeer[];
  relayHttpPort: number;
  instanceNum: number;
  relayUrl: string;
  sharedRelayUrl: string | null;
  groups: Group[];
  selectedGroup: Group | null;
  onSelectGroup: (g: Group) => void;
  onLeaveGroup: (g: Group) => void;
  onCreateGroup: () => void;
  groupLastMessages: Map<string, any>;
  groupUnreadCounts: Map<string, number>;
  groupKeyDistStatus?: Map<string, string>;
  onlineContacts: Map<string, number>;
  onSelectContact: (c: Contact) => void;
  onDeleteContact: (c: Contact) => void;
  onAddContact: (hex: string, nick?: string, circuitAddr?: string) => Promise<void>;
  onStartNode: () => void;
  onDisconnect: () => void;
  onInitSession: (addr: string) => void;
  onRelayPortChange: (port: number) => void;
  onRelayUrlChange: (url: string) => void;
  onToggleSharedRelay: () => void;
  mobileSidebarOpen: boolean;
  onionEnabled: boolean;
  onToggleOnion: (enabled: boolean) => void;
  aiSettings: AiSettingsT;
  onAiSettingsChange: (next: AiSettingsT) => void;
}

type Tab = 'chats' | 'groups' | 'peers' | 'settings';

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  chats: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  groups: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  peers: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
};

const TAB_LABELS: Record<Tab, string> = { chats: 'Chats', groups: 'Groups', peers: 'Peers', settings: 'Settings' };

const STATUS_CONFIG = {
  idle:       { color: 'var(--text3)',  label: 'Offline',      dot: false },
  connecting: { color: 'var(--yellow)', label: 'Connecting…',  dot: true  },
  connected:  { color: 'var(--green)',  label: 'Connected',    dot: false },
  chatting:   { color: 'var(--accent)', label: 'Chatting',     dot: false },
};

export function Sidebar(props: Props) {
  const {
    identity, contacts, selectedContact, nodeStatus, circuitAddr,
    discoveredPeers, relayUrl, sharedRelayUrl,
    groups, selectedGroup, onSelectGroup, onLeaveGroup, onCreateGroup,
    groupLastMessages, groupUnreadCounts, groupKeyDistStatus,
    onSelectContact, onDeleteContact, onAddContact,
    onStartNode, onDisconnect, onInitSession, onRelayPortChange, onRelayUrlChange,
    onToggleSharedRelay, onlineContacts, mobileSidebarOpen,
    onionEnabled, onToggleOnion,
    aiSettings, onAiSettingsChange,
  } = props;

  const [tab, setTab]             = useState<Tab>('chats');
  const [showAddModal, setShowAddModal] = useState(false);
  const [copied, setCopied]       = useState<'key' | 'circuit' | null>(null);

  const isDesktop = !!(window as any).kantDesktop?.isDesktop;
  // Settings gets a wider sidebar on roomy screens (Electron + web); mobile
  // CSS overrides force 100% width with !important regardless.
  const settingsWide = tab === 'settings' && window.innerWidth > 900;
  const mobileClass = mobileSidebarOpen ? 'sidebar-mobile-visible' : 'sidebar-mobile-hidden';
  const sc = STATUS_CONFIG[nodeStatus];

  async function copy(text: string, which: 'key' | 'circuit') {
    await copyToClipboard(text);
    if (!text) return;
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  const totalUnread = Array.from(groupUnreadCounts.values()).reduce((a, b) => a + b, 0);

  return (
    <div
      style={{
        ...s.root,
        width: settingsWide ? 'var(--sidebar-w-settings)' : 'var(--sidebar-w)',
        minWidth: settingsWide ? 'var(--sidebar-w-settings)' : 'var(--sidebar-w)',
      }}
      className={mobileClass}
    >
      {/* ── Header ── */}
      <div style={s.header}>
        <div style={s.logoRow}>
          <img src="/logo-clean.png" alt="Kant" style={s.logoImg} />
          <div>
            <div style={s.appName}>Kant</div>
            <div style={{ ...s.statusRow, color: sc.color }}>
              <span style={{
                ...s.statusDot,
                background: sc.color,
                ...(sc.dot ? { animation: 'blink 1.4s ease infinite' } : {}),
              }} />
              {sc.label}
            </div>
          </div>
        </div>

        {identity && (
          <button
            onClick={() => copy(identity.publicKeyHex, 'key')}
            style={s.copyKeyBtn}
            title="Copy your public key"
          >
            {copied === 'key' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
          </button>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={s.tabBar} className="tab-bar-mobile">
        {(['chats', 'groups', 'peers', 'settings'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...s.tabBtn, ...(tab === t ? s.tabBtnActive : {}) }}
            title={t.charAt(0).toUpperCase() + t.slice(1)}
            aria-current={tab === t ? 'page' : undefined}
          >
            <span style={s.tabIcon}>{TAB_ICONS[t]}</span>
            <span style={s.tabLabel} className="tab-btn-label">{TAB_LABELS[t]}</span>
            {t === 'groups' && totalUnread > 0 && tab !== 'groups' && (
              <span style={s.tabBadge}>{totalUnread > 9 ? '9+' : totalUnread}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={s.content}>
        {tab === 'chats' && (
          <>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>Contacts</span>
              <button onClick={() => setShowAddModal(true)} style={s.addBtn} aria-label="Add contact" title="Add contact">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
            <ContactList
              contacts={contacts}
              selected={selectedContact}
              onSelect={onSelectContact}
              onDelete={onDeleteContact}
              onInitSession={onInitSession}
              nodeStatus={nodeStatus}
              onlineContacts={onlineContacts}
            />
          </>
        )}

        {tab === 'groups' && (
          <GroupList
            groups={groups}
            selected={selectedGroup}
            myPubKeyHex={identity?.publicKeyHex ?? ''}
            onSelect={onSelectGroup}
            onLeave={onLeaveGroup}
            onCreate={onCreateGroup}
            lastMessages={groupLastMessages}
            unreadCounts={groupUnreadCounts}
            keyDistStatus={groupKeyDistStatus}
          />
        )}

        {tab === 'peers' && (
          <div style={s.peerList}>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>Discovered Peers</span>
            </div>
            {discoveredPeers.length === 0 ? (
              <div style={s.emptyPeers}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>No peers found</p>
                <p style={{ fontSize: 12, color: 'var(--text3)' }}>Peers on your relay appear here automatically</p>
              </div>
            ) : (
              discoveredPeers.map(p => (
                <div key={p.peerId} style={s.peerRow}>
                  <div style={s.peerAvatar}>
                    {p.peerId.slice(-2).toUpperCase()}
                  </div>
                  <div style={s.peerInfo}>
                    <div style={s.peerId}>{p.peerId.slice(0, 22)}…</div>
                    <div style={s.peerAddr}>{p.multiaddrs[0]?.slice(0, 28)}…</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'settings' && (
          <SettingsPanel
            identity={identity}
            circuitAddr={circuitAddr}
            relayUrl={relayUrl}
            sharedRelayUrl={sharedRelayUrl}
            nodeStatus={nodeStatus}
            isDesktop={isDesktop}
            onionEnabled={onionEnabled}
            onRelayUrlChange={onRelayUrlChange}
            onRelayPortChange={onRelayPortChange}
            onToggleSharedRelay={onToggleSharedRelay}
            onToggleOnion={onToggleOnion}
            aiSettings={aiSettings}
            onAiSettingsChange={onAiSettingsChange}
          />
        )}
      </div>

      {/* ── Connect / Disconnect buttons ── */}
      <div style={s.footer} className="sidebar-footer-mobile">
        <button
          onClick={onStartNode}
          disabled={nodeStatus === 'connecting'}
          style={{
            ...s.connectBtn,
            flex: 1,
            background: nodeStatus === 'idle'
              ? 'linear-gradient(135deg,#4f8ef7,#6b7cf7)'
              : nodeStatus === 'connecting'
              ? 'var(--bg4)'
              : 'var(--bg3)',
            boxShadow: nodeStatus === 'idle'
              ? '0 4px 20px rgba(79,142,247,0.35)'
              : 'none',
            color: nodeStatus === 'idle' ? '#fff' : 'var(--text2)',
          }}
        >
          {nodeStatus === 'connecting' ? (
            <><Spinner size={15} color="var(--text2)" /> Connecting…</>
          ) : nodeStatus === 'idle' ? (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              Connect to Network
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Reconnect
            </>
          )}
        </button>
        {(nodeStatus === 'connected' || nodeStatus === 'chatting') && (
          <button
            onClick={onDisconnect}
            style={{
              ...s.connectBtn,
              background: 'var(--bg4)',
              color: 'var(--text3)',
              flex: '0 0 auto',
              padding: '0 14px',
              fontSize: 11,
            }}
            title="Disconnect"
            aria-label="Disconnect"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {showAddModal && (
        <AddContactModal
          onAdd={async (hex, nick, addr) => { await onAddContact(hex, nick, addr); setShowAddModal(false); }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  identity: UnlockedIdentity | null;
  circuitAddr: string;
  relayUrl: string;
  sharedRelayUrl: string | null;
  nodeStatus: NodeStatus;
  isDesktop: boolean;
  onionEnabled: boolean;
  onRelayUrlChange: (url: string) => void;
  onRelayPortChange: (port: number) => void;
  onToggleSharedRelay: () => void;
  onToggleOnion: (enabled: boolean) => void;
  aiSettings: AiSettingsT;
  onAiSettingsChange: (next: AiSettingsT) => void;
}

type SettingsSection = 'network' | 'privacy' | 'ai' | 'identity' | 'danger';

const SECTION_META: Record<SettingsSection, { label: string; desc: string }> = {
  network:  { label: 'Network & Relay',   desc: 'How you connect to the network' },
  privacy:  { label: 'Privacy & Routing', desc: 'Onion routing and anonymity settings' },
  ai:       { label: 'AI & Agents',       desc: 'Local model and MCP agent access' },
  identity: { label: 'Identity & Keys',   desc: 'Your cryptographic identity' },
  danger:   { label: 'Danger Zone',       desc: 'Irreversible actions' },
};

const SECTION_ICONS: Record<SettingsSection, React.ReactNode> = {
  network: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  privacy: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  ai: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      <circle cx="12" cy="16" r="1" fill="currentColor"/>
    </svg>
  ),
  identity: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
  ),
  danger: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
};

function SettingsPanel(props: SettingsPanelProps) {
  const {
    identity, circuitAddr, relayUrl, sharedRelayUrl, nodeStatus, isDesktop,
    onionEnabled, onRelayUrlChange, onRelayPortChange, onToggleSharedRelay, onToggleOnion,
    aiSettings, onAiSettingsChange,
  } = props;

  const [copied, setCopied] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  async function copy(text: string, key: string) {
    await copyToClipboard(text);
    if (!text) return;
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleWipe() {
    if (!confirmWipe) { setConfirmWipe(true); return; }
    setWiping(true);
    try {
      const { wipeIdentity } = await import('@kant/core');
      await wipeIdentity();
      window.location.reload();
    } catch {
      setWiping(false);
      setConfirmWipe(false);
    }
  }

  return (
    <div style={sp.root}>
      {/* Page header */}
      <div style={sp.pageHeader}>
        <div style={sp.pageTitle}>Settings</div>
        <div style={sp.pageSub}>Network, privacy, AI and identity — all on one page</div>
      </div>

      {/* All sections stacked in one scrollable page */}
      <div style={sp.sections}>

        {/* ── Network & Relay ── */}
        <SettingsSection section="network">
          <RelaySettings
            relayUrl={relayUrl}
            sharedRelayUrl={sharedRelayUrl}
            nodeStatus={nodeStatus}
            isDesktop={isDesktop}
            onionEnabled={onionEnabled}
            onRelayUrlChange={onRelayUrlChange}
            onRelayPortChange={onRelayPortChange}
            onToggleSharedRelay={onToggleSharedRelay}
            onToggleOnion={onToggleOnion}
          />
        </SettingsSection>

        {/* ── Privacy & Routing ── */}
        <SettingsSection section="privacy">
          <div style={sp.section}>
            <div style={sp.card}>
              <div style={sp.cardRow}>
                <div style={sp.cardRowInfo}>
                  <div style={sp.cardRowLabel}>Enable onion routing</div>
                  <div style={sp.cardRowDesc}>
                    Messages are wrapped in {'{'}2{'}'} encrypted layers and forwarded through intermediate peers.
                    Falls back to direct delivery when no hops are available.
                  </div>
                </div>
                <ToggleSwitch enabled={onionEnabled} onChange={onToggleOnion} />
              </div>
            </div>

            {onionEnabled && (
              <div style={sp.infoBox}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                  Onion routing requires at least one other Kant peer online on the same relay.
                  With no eligible hops, messages are delivered directly — your privacy degrades
                  gracefully rather than failing.
                </p>
              </div>
            )}

            <div style={sp.sectionHeader}>
              <div style={sp.sectionTitle}>Security Model</div>
            </div>
            <div style={sp.card}>
              {[
                { label: 'End-to-end encryption', value: 'Double Ratchet + XChaCha20-Poly1305', ok: true },
                { label: 'Key exchange', value: 'X3DH with signed pre-keys', ok: true },
                { label: 'Identity', value: 'Ed25519 keypair, local only', ok: true },
                { label: 'At-rest encryption', value: 'Argon2id + XSalsa20-Poly1305', ok: true },
                { label: 'Server storage', value: 'None — messages never leave your device', ok: true },
                { label: 'Metadata', value: 'Relay sees encrypted noise only', ok: true },
              ].map(row => (
                <div key={row.label} style={sp.secRow}>
                  <span style={sp.secLabel}>{row.label}</span>
                  <span style={sp.secValue}>
                    <span style={{ color: 'var(--green)', fontSize: 10, marginRight: 5 }}>●</span>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SettingsSection>

        {/* ── AI & Agents ── */}
        <SettingsSection section="ai">
          <AiSettings settings={aiSettings} onChange={onAiSettingsChange} />
        </SettingsSection>

        {/* ── Identity & Keys ── */}
        <SettingsSection section="identity">
          {identity ? (
            <div style={sp.section}>
              <div style={sp.card}>
                <div style={sp.cardLabel}>Public Key</div>
                <div style={sp.cardDesc}>Share this with contacts so they can add you.</div>
                <div
                  style={sp.monoBox}
                  onClick={() => copy(identity.publicKeyHex, 'pubkey')}
                  title="Click to copy"
                >
                  <span style={sp.monoText}>{identity.publicKeyHex}</span>
                  <span style={{ ...sp.copyTag, color: copied === 'pubkey' ? 'var(--green)' : 'var(--accent)' }}>
                    {copied === 'pubkey' ? '✓ Copied' : 'Copy'}
                  </span>
                </div>
              </div>

              {circuitAddr && (
                <div style={sp.card}>
                  <div style={sp.cardLabel}>Circuit Address</div>
                  <div style={sp.cardDesc}>Your current relay circuit address. Updates on each connection.</div>
                  <div
                    style={sp.monoBox}
                    onClick={() => copy(circuitAddr, 'circuit')}
                    title="Click to copy"
                  >
                    <span style={sp.monoText}>{circuitAddr}</span>
                    <span style={{ ...sp.copyTag, color: copied === 'circuit' ? 'var(--green)' : 'var(--accent)' }}>
                      {copied === 'circuit' ? '✓ Copied' : 'Copy'}
                    </span>
                  </div>
                </div>
              )}

              <div style={sp.infoBox}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                  Your private key is encrypted with Argon2id (256 MB RAM, ~1s) and stored only in
                  IndexedDB on this device. It is not sent to the relay.
                </p>
              </div>
            </div>
          ) : (
            <div style={sp.emptyState}>
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>No identity loaded — unlock first.</p>
            </div>
          )}
        </SettingsSection>

        {/* ── Danger Zone ── */}
        <SettingsSection section="danger">
          <div style={sp.card}>
            <div style={sp.dangerRow}>
              <div>
                <div style={sp.dangerLabel}>Full Wipe</div>
                <div style={sp.dangerDesc}>
                  Permanently deletes your identity, all contacts, all messages, all keys, and all
                  queued data from this device. Cannot erase messages already received by your contacts.
                </div>
              </div>
              <button
                onClick={handleWipe}
                disabled={wiping}
                style={{
                  ...sp.wipeBtn,
                  background: confirmWipe
                    ? 'var(--red)'
                    : 'rgba(248,113,113,0.12)',
                  color: confirmWipe ? '#fff' : 'var(--red)',
                  border: confirmWipe ? 'none' : '1px solid rgba(248,113,113,0.3)',
                }}
              >
                {wiping
                  ? <><Spinner size={14} color={confirmWipe ? '#fff' : 'var(--red)'} /> Wiping…</>
                  : confirmWipe
                  ? '⚠ Confirm — this cannot be undone'
                  : 'Wipe All Data'}
              </button>
            </div>
            {confirmWipe && !wiping && (
              <div style={sp.wipeWarning} className="fade-in">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--red)', flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ fontSize: 12, color: 'var(--red)', lineHeight: 1.5 }}>
                  This erases your identity, all messages, and all keys from <strong>this device only</strong>.
                  It cannot erase messages already received and stored by your contacts,
                  or any copies they have made.
                </span>
                <button
                  onClick={() => setConfirmWipe(false)}
                  style={sp.cancelWipeBtn}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

/** One collapsible card in the single-page settings layout. Keeps its children
 *  mounted so nested state (relay mode, log tab, inputs) survives collapse. */
function SettingsSection({ section, children, danger }: {
  section: SettingsSection;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const meta = SECTION_META[section];
  return (
    <div style={{ ...sec.card, ...(danger ? sec.cardDanger : {}) }}>
      <button
        onClick={() => setOpen(!open)}
        style={sec.header}
        aria-expanded={open}
      >
        <span style={{ ...sec.iconTile, ...(danger ? sec.iconTileDanger : {}) }}>
          {SECTION_ICONS[section]}
        </span>
        <span style={sec.headerText}>
          <span style={sec.title}>{meta.label}</span>
          <span style={sec.desc}>{meta.desc}</span>
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ ...sec.chevron, ...(!open ? sec.chevronClosed : {}) }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div style={{ display: open ? undefined : 'none' }}>
        <div style={sec.bodyInner}>{children}</div>
      </div>
    </div>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 99,
        background: enabled ? 'var(--accent)' : 'var(--bg5)',
        border: '1px solid ' + (enabled ? 'var(--accent)' : 'var(--border)'),
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s, border-color 0.2s',
        minHeight: 'unset',
        padding: 0,
        boxShadow: enabled ? '0 0 0 3px var(--accent-dim)' : 'none',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: enabled ? 22 : 2,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s cubic-bezier(0.16,1,0.3,1)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

const sp: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  pageHeader: {
    padding: '12px 16px 10px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  pageTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--text1)',
    letterSpacing: '-0.3px',
  },
  pageSub: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 2,
  },
  sections: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sectionHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text1)',
    letterSpacing: '-0.2px',
  },
  sectionDesc: {
    fontSize: 12,
    color: 'var(--text3)',
    lineHeight: 1.5,
  },
  card: {
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardRowLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    marginBottom: 3,
  },
  cardRowDesc: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.5,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.4,
    marginBottom: 8,
  },
  monoBox: {
    background: 'var(--bg4)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    transition: 'border-color 0.15s',
  },
  monoText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: 'var(--text2)',
    wordBreak: 'break-all',
    flex: 1,
    lineHeight: 1.6,
  },
  copyTag: {
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
    transition: 'color 0.2s',
  },
  secRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  secLabel: {
    fontSize: 11,
    color: 'var(--text3)',
    flexShrink: 0,
  },
  secValue: {
    fontSize: 11,
    color: 'var(--text2)',
    textAlign: 'right',
    lineHeight: 1.4,
  },
  infoBox: {
    display: 'flex',
    gap: 10,
    background: 'var(--accent-dim)',
    border: '1px solid rgba(79,142,247,0.2)',
    borderRadius: 10,
    padding: '12px',
    alignItems: 'flex-start',
  },
  dangerRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  dangerLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--red)',
    marginBottom: 4,
  },
  dangerDesc: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.5,
  },
  wipeBtn: {
    padding: '10px 16px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.2s, color 0.2s',
    minHeight: 'unset',
    alignSelf: 'flex-start',
  },
  wipeWarning: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    background: 'rgba(248,113,113,0.08)',
    borderRadius: 8,
    border: '1px solid rgba(248,113,113,0.2)',
  },
  cancelWipeBtn: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text2)',
    background: 'var(--bg4)',
    borderRadius: 6,
    padding: '4px 10px',
    flexShrink: 0,
    minHeight: 'unset',
  },
  emptyState: {
    padding: '32px 0',
    textAlign: 'center',
  },
};

// ── Settings section card ─────────────────────────────────────────────────────

const sec: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    overflow: 'hidden',
    flexShrink: 0,
  },
  cardDanger: {
    borderColor: 'rgba(248,113,113,0.28)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    minHeight: 'unset',
    transition: 'background 0.12s',
  },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg3)',
    color: 'var(--accent)',
    border: '1px solid var(--border)',
  },
  iconTileDanger: {
    color: 'var(--red)',
    background: 'rgba(248,113,113,0.08)',
    borderColor: 'rgba(248,113,113,0.2)',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  desc: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.3,
  },
  chevron: {
    color: 'var(--text3)',
    flexShrink: 0,
    transition: 'transform 0.2s cubic-bezier(0.16,1,0.3,1)',
  },
  chevronClosed: {
    transform: 'rotate(-90deg)',
  },
  bodyInner: {
    padding: '14px',
  },
};

// ── Main styles ────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    width: 'var(--sidebar-w)',
    minWidth: 'var(--sidebar-w)',
    background: 'var(--bg1)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    transition: 'transform 0.28s cubic-bezier(0.16,1,0.3,1)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 16px 14px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoImg: {
    height: 32,
    width: 'auto',
    display: 'block',
    flexShrink: 0,
  },
  appName: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text1)',
    letterSpacing: '-0.4px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  copyKeyBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text3)',
    background: 'var(--bg3)',
    minHeight: 'unset',
    transition: 'background 0.15s, color 0.15s',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1,
    padding: '9px 4px 8px',
    margin: '4px 4px 6px',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    color: 'var(--text3)',
    transition: 'color 0.15s, background 0.15s',
    position: 'relative',
    minHeight: 'unset',
  },
  tabIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: '0.3px',
    lineHeight: 1,
  },
  tabBtnActive: {
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
  },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: 'calc(50% - 19px)',
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 99,
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 5px',
    lineHeight: 1.4,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    paddingTop: 8,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px 8px 20px',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
    borderRadius: 8,
    padding: '5px 10px',
    fontWeight: 600,
    minHeight: 'unset',
  },
  peerList: {
    display: 'flex',
    flexDirection: 'column',
  },
  emptyPeers: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '40px 24px',
  },
  peerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderRadius: 10,
    background: 'var(--bg2)',
    margin: '0 12px 6px',
  },
  peerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 11,
    background: 'var(--bg4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text2)',
    flexShrink: 0,
  },
  peerInfo: { flex: 1, minWidth: 0 },
  peerId: {
    fontSize: 12,
    color: 'var(--text1)',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  peerAddr: {
    fontSize: 10,
    color: 'var(--text3)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginTop: 2,
  },
  footer: {
    padding: '12px 16px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
    display: 'flex',
    gap: 6,
  },
  connectBtn: {
    flex: 1,
    padding: '12px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'background 0.2s, box-shadow 0.2s, opacity 0.15s, transform 0.1s',
  },
};
