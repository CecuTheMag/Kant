import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { Contact, Group, MessageAttachment, NodeStatus, PlainMessage, RouteHop } from '../../core/types';
import { STATUS_COPY, displayName, statusForScenario } from '../../core/mock';
import type { Scenario } from '../../core/mock';
import { dayLabel, expiryLabel, fileSize, formatTime, listStamp, relativeSeen, sameDay } from '../../core/format';
import { groupedKey } from '../../core/fingerprint';
import { useStore } from '../../core/store';
import {
  Alert, ArrowRight, Check, ChevronLeft, Clock, Command, Copy, DoubleCheck, Download, Eye, EyeOff, Globe,
  Lock as LockIcon, Message, Paperclip, Plus, QR, Search, Send, Settings as SettingsIcon,
  Shield, ShieldAlert, ShieldCheck, Spinner, Trash, Users, X,
} from '../../components/icons';
import { Avatar, Fingerprint, Glyph, RouteSpine, ShortKey, SpineMini, StatusChip, TRUST_COPY, TrustBadge } from './parts';
import { AddContactModal, NewGroupModal } from '../../components/modals';
import { DeliveryHealth } from '../../components/DeliveryHealth';
import './tokens.css';
import './instrument.css';

type Tab = 'chats' | 'groups' | 'peers' | 'debug' | 'settings';
type ContactMenu = { contactId: string; x: number; y: number };
type MessageMenu = { messageId: string; text: string; x: number; y: number };
type ReplyTo = { id: string; text: string; from: string } | null;

/** Clipboard with fallback — clipboard API needs a secure context; LAN IPs aren't one. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** Request notification permission once and fire a notification when the page is hidden. */
function useNotifications(contacts: import('../../core/types').Contact[], threads: Record<string, import('../../core/types').PlainMessage[]>, groupThreads: Record<string, import('../../core/types').PlainMessage[]>, groups: import('../../core/types').Group[]) {
  const prevCountsRef = useRef<Record<string, number>>({});
  const permissionRef = useRef<NotificationPermission>('default');

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { permissionRef.current = 'granted'; return; }
    if (Notification.permission === 'denied') return;
    Notification.requestPermission().then(p => { permissionRef.current = p; });
  }, []);

  useEffect(() => {
    if (permissionRef.current !== 'granted') return;
    const prev = prevCountsRef.current;
    const next: Record<string, number> = {};

    for (const c of contacts) {
      const id = c.id!;
      const msgs = threads[id] ?? [];
      next[id] = msgs.length;
      const prevLen = prev[id] ?? msgs.length;
      if (msgs.length > prevLen && document.hidden) {
        const last = msgs[msgs.length - 1];
        if (last.from !== 'me') {
          new Notification(c.nickname ?? c.publicKeyHex.slice(0, 12), {
            body: last.text || 'Sent an attachment',
            tag: `msg-${id}`,
            silent: false,
          });
        }
      }
    }

    for (const g of groups) {
      const msgs = groupThreads[g.id] ?? [];
      next[`g:${g.id}`] = msgs.length;
      const prevLen = prev[`g:${g.id}`] ?? msgs.length;
      if (msgs.length > prevLen && document.hidden) {
        const last = msgs[msgs.length - 1];
        if (last.from !== 'me') {
          new Notification(g.name, {
            body: last.text || 'Sent an attachment',
            tag: `grp-${g.id}`,
            silent: false,
          });
        }
      }
    }

    prevCountsRef.current = next;
  });
}

/** Scroll a container ref to the bottom whenever deps change. */
function useAutoScroll(ref: { current: HTMLDivElement | null }, deps: unknown[]) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Focusing the composer opens the on-screen keyboard, which shrinks the
  // visual viewport without touching conv-body's scrollTop — a thread that was
  // pinned to the bottom ends up showing older messages behind the keyboard.
  // Re-pin on every viewport resize for as long as this pane is mounted.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const rePin = () => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; };
    vv.addEventListener('resize', rePin);
    return () => vv.removeEventListener('resize', rePin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface Props {
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}

export function InstrumentApp({ scenario, onScenario }: Props) {
  const store = useStore();
  const { state } = store;
  const firstRun = scenario === 'first-run';
  /* Live status always wins — the first-run scenario only gates the GetStarted
     screen, never the connection state (real app can be connected with 0 contacts). */
  const status = state.status;
  const [tab, setTab] = useState<Tab>('chats');
  const [selected, setSelected] = useState<string | null>(state.contacts[0]?.id ?? null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'main'>('main');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'unverified'>('all');
  const [ackedKeyChange, setAckedKeyChange] = useState(false);
  const [contactMenu, setContactMenu] = useState<ContactMenu | null>(null);
  const hydratedContactRef = useRef<string | null>(null);

  /* Real route provenance: the mock's routeForStatus would leak fake hop names
     ("Mara", "5 hops") into the live app. Derive the path from actual state:
     you → relay (real host) → peer (real short id). Latencies aren't measured
     per hop by the backend, so they're omitted (the design hides ms when absent). */
  const hops: RouteHop[] = (() => {
    if (status === 'offline') return [];
    const relayLabel = (() => { try { return new URL(state.settings.relay).host; } catch { return state.settings.relay; } })();
    const out: RouteHop[] = [{ label: 'you', kind: 'self' }];
    if (status === 'connecting') return out;
    out.push({ label: relayLabel, kind: 'relay' });
    if (selected && status !== 'relay') {
      const c = state.contacts.find((x) => x.id === selected);
      out.push({ label: c ? (c.nickname ?? c.publicKeyHex.slice(0, 12)) : 'peer', kind: 'peer' });
    }
    return out;
  })();

  /* Scenario drives the app into the right screen. This is what lets the States explorer
     reach places that are otherwise a two-browser, live-relay exercise. */
  /* The States explorer drives the REAL store — picking "Key changed" actually rotates that
     contact's key rather than faking a flag, so what you see is the genuine code path. */
  useEffect(() => {
    setAckedKeyChange(false);
    const cs = store.state.contacts;
    const broken = cs.find((c) => c.trust === 'changed');
    const pick = (i: number) => cs[i]?.id ?? null;

    if (scenario === 'key-changed') {
      setTab('chats'); setSelectedGroup(null); setVerifyFor(null);
      const target = broken ?? cs[1];
      if (target) {
        setSelected(target.id!);
        if (target.trust !== 'changed') store.rotateKey(target.id!);
      }
    } else if (scenario === 'verify') {
      setTab('chats'); setSelectedGroup(null); setSelected(pick(1)); setVerifyFor(pick(1));
    } else if (scenario === 'empty-thread') {
      setTab('chats'); setSelectedGroup(null); setSelected(pick(4)); setVerifyFor(null);
    } else if (scenario === 'first-run') {
      setTab('chats'); setSelectedGroup(null); setSelected(null); setVerifyFor(null);
    } else {
      setVerifyFor(null);
      setSelected((v) => v ?? pick(0));
      store.setStatus(statusForScenario(scenario));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  /* Escape/click closes sheets and the native-style conversation menu. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setVerifyFor(null); setContactMenu(null); }
    };
    const closeMenu = () => setContactMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, []);

  const contacts = firstRun ? [] : state.contacts;
  // A valid group-key delivery can arrive before the recipient has added any
  // contacts. Keep persisted groups visible even while the contact onboarding
  // state is otherwise shown as first-run.
  const groups = state.groups;

  useNotifications(contacts, state.threads, state.groupThreads, groups);
  const activeContact = useMemo(
    () => contacts.find((c) => c.id === selected) ?? null,
    [contacts, selected],
  );

  useEffect(() => {
    if (!selected || hydratedContactRef.current === selected) return;
    hydratedContactRef.current = selected;
    store.selectContact?.(selected);
  }, [selected, store.selectContact]);

  /*
   * Report whether the conversation is genuinely on screen.
   *
   * Selection alone does not answer this. Below 700px the list and the
   * conversation are alternating full-screen views and going back to the list
   * does not deselect; on any width, switching to Settings or Peers replaces
   * the conversation pane. Without this the backend treats the last-opened chat
   * as being read forever, so messages from that one contact never raise an
   * unread marker or a notification.
   */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const report = () => {
      const paneShown = tab === 'chats' && !firstRun && !!activeContact;
      store.setConversationVisible?.(paneShown && (!mq.matches || mobileView === 'main'));
    };
    report();
    mq.addEventListener('change', report);
    return () => mq.removeEventListener('change', report);
    // store is rebuilt every render, so it is deliberately not a dependency —
    // including it would re-register the media listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, firstRun, activeContact, mobileView]);

  const openContact = useCallback((id: string) => {
    setSelected(id);
    setSelectedGroup(null);
    setMobileView('main');
    store.markRead(id);
    store.selectContact?.(id);
    hydratedContactRef.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const openContactMenu = useCallback((event: ReactMouseEvent, contactId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContactMenu({
      contactId,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 110),
    });
  }, []);

  const deleteContact = useCallback((contactId: string) => {
    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return;
    if (!window.confirm(`Delete ${displayName(contact)} and this conversation from this device?`)) return;
    store.removeContact(contactId);
    if (selected === contactId) setSelected(null);
    setDrawer(false);
    setContactMenu(null);
  }, [selected, state.contacts, store]);

  if (scenario === 'loading' || !state.ready) return <BootScreen />;
  if (scenario === 'auth-create' || scenario === 'auth-unlock' || scenario === 'auth-error') {
    return (
      <AuthScreen
        mode={scenario === 'auth-create' ? 'create' : 'unlock'}
        error={scenario === 'auth-error'}
        onDone={() => onScenario('first-run')}
      />
    );
  }

  const verifyContact = verifyFor ? state.contacts.find((c) => c.id === verifyFor) ?? null : null;

  return (
    <div className="inst" data-dir="instrument" data-density={state.settings.density} data-mobile-view={mobileView} onMouseDown={() => setContactMenu(null)}>
      {/* ---------- rail ---------- */}
      <nav className="inst-rail" aria-label="Sections">
        <div className="inst-rail-logo"><KantMark /></div>

        <RailBtn label="Chats" active={tab === 'chats'} badge={unreadTotal(contacts)} onClick={() => { setTab('chats'); setMobileView('list'); }}>
          <Message size={19} />
        </RailBtn>
        <RailBtn label="Groups" active={tab === 'groups'} badge={groups.reduce((a, g) => a + (g.unread ?? 0), 0)} onClick={() => { setTab('groups'); setMobileView('list'); }}>
          <Users size={19} />
        </RailBtn>
        <RailBtn label="Peers" active={tab === 'peers'} onClick={() => { setTab('peers'); setMobileView('list'); }}>
          <Globe size={19} />
        </RailBtn>
        <RailBtn label="Debug" active={tab === 'debug'} badge={state.debugLog.length} onClick={() => { setTab('debug'); setMobileView('list'); }}>
          <Command size={19} />
        </RailBtn>

        <div className="inst-rail-spacer" />

        <div className="inst-rail-divider" />
        <RailBtn label="Settings" active={tab === 'settings'} onClick={() => { setTab('settings'); setMobileView('list'); }}>
          <SettingsIcon size={19} />
        </RailBtn>
      </nav>

      {/* ---------- list pane ---------- */}
      <section className="inst-list" aria-label={tabTitle(tab)}>
        <header className="inst-head">
          <h1 className="inst-head-title">{tabTitle(tab)}</h1>
          <div className="inst-head-spacer" />
          {tab === 'chats' && (
            <button className="btn btn-ghost btn-icon" aria-label="Add contact" title="Add contact" onClick={() => setAddOpen(true)}>
              <Plus size={15} />
            </button>
          )}
          {tab === 'groups' && (
            <button className="btn btn-ghost btn-icon" aria-label="New group" title="New group" onClick={() => setGroupOpen(true)}>
              <Plus size={15} />
            </button>
          )}
        </header>

        {/* Status lives here — always visible, one row under the title. Not a dead grey word,
            and not buried three screens deep in Settings. */}
        <div className="inst-statusbar">
          <StatusChip status={status} hops={hops} relay={state.settings.relay} onConnect={store.connect} />
          <span className="t-caption" style={{ marginLeft: 'auto' }}>
            {status === 'offline' ? 'Not connected'
              : status === 'connecting' ? 'Dialing…'
              : status === 'error' ? 'Dial failed'
              : `${hops.length} hops`}
          </span>
        </div>

        {tab === 'settings' ? (
          <SettingsPane status={status} />
        ) : tab === 'debug' ? (
          <DebugPane status={status} />
        ) : tab === 'peers' ? (
          <PeersPane status={status} />
        ) : (
          <>
            <div className="inst-search">
              <div className="input-wrap">
                <Search size={13} color="var(--fg-tertiary)" />
                <input
                  className="input"
                  placeholder={tab === 'chats' ? 'Search contacts or keys' : 'Search groups'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search"
                  spellCheck={false}
                />
                {query && (
                  <button className="btn btn-ghost" style={{ padding: 4, height: 20, minWidth: 20 }} onClick={() => setQuery('')} aria-label="Clear search">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {tab === 'chats' && contacts.length > 0 && (
              <div className="inst-filters" role="group" aria-label="Filters">
                <FilterChip id="all" active={filter} set={setFilter} count={contacts.length}>All</FilterChip>
                <FilterChip id="unread" active={filter} set={setFilter} count={contacts.filter((c) => c.unread).length}>Unread</FilterChip>
                <FilterChip id="unverified" active={filter} set={setFilter} count={contacts.filter((c) => c.trust !== 'verified').length}>Unverified</FilterChip>
              </div>
            )}

            <div className="inst-rows" role="listbox" aria-label={tabTitle(tab)}>
              {tab === 'chats'
                ? <ContactRows contacts={filterContacts(contacts, query, filter)} selected={selected} onSelect={openContact} onContextMenu={openContactMenu} query={query} onAdd={() => setAddOpen(true)} />
                : <GroupRows groups={groups} selected={selectedGroup} onSelect={(id) => {
                    setSelectedGroup(id);
                    setSelected(null);
                    setMobileView('main');
                    store.selectGroup?.(id);
                  }} onCreate={() => setGroupOpen(true)} />}
            </div>
          </>
        )}
      </section>

      {/* ---------- main pane ---------- */}
      <main className="inst-main">
        {tab === 'settings' ? (
          <SettingsDetail status={status} />
        ) : tab === 'debug' ? (
          <DebugDetail status={status} />
        ) : tab === 'peers' ? (
          <PeersDetail status={status} />
        ) : firstRun && tab === 'chats' ? (
          <GetStarted onConnect={store.connect} onAdd={() => setAddOpen(true)} status={status} meHex={state.meHex} />
        ) : tab === 'groups' ? (
          /* Key the main pane off the active tab, not just off whatever was last selected —
             otherwise switching to Groups leaves the previous contact's conversation open. */
          selectedGroup ? (
            <GroupConversation groupId={selectedGroup} status={status} hops={hops} onBack={() => setMobileView('list')} />
          ) : (
            <div className="empty">
              <div className="empty-mark"><Users size={18} /></div>
              <div className="empty-title">No group open</div>
              <div className="empty-text">Pick a group from the list. Everyone in a group has to be one of your contacts first.</div>
            </div>
          )
        ) : activeContact ? (
          <Conversation
            contact={activeContact}
            status={status}
            hops={hops}
            scenario={scenario}
            ackedKeyChange={ackedKeyChange}
            onAckKeyChange={() => setAckedKeyChange(true)}
            onVerify={() => setVerifyFor(activeContact.id!)}
            onBack={() => setMobileView('list')}
            onToggleDrawer={() => setDrawer((v) => !v)}
          />
        ) : (
          <div className="empty">
            <div className="empty-mark"><Message size={18} /></div>
            <div className="empty-title">No conversation open</div>
            <div className="empty-text">
              Pick someone from the list to start talking.
            </div>
          </div>
        )}
      </main>

      {/* ---------- detail drawer ---------- */}
      {drawer && activeContact && tab === 'chats' && (
        <aside className="inst-drawer" aria-label="Contact detail">
          <ContactDetail
            contact={activeContact}
            onVerify={() => setVerifyFor(activeContact.id!)}
            onClose={() => setDrawer(false)}
          />
        </aside>
      )}

      {/* ---------- overlays ---------- */}
      {verifyContact && <VerifySheet contact={verifyContact} onClose={() => setVerifyFor(null)} />}

      {addOpen && <AddContactModal onClose={() => setAddOpen(false)} />}
      {groupOpen && <NewGroupModal onClose={() => setGroupOpen(false)} />}
      {contactMenu && (
        <div
          className="conversation-menu"
          role="menu"
          style={{ left: contactMenu.x, top: contactMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" onClick={() => { openContact(contactMenu.contactId); setContactMenu(null); }}>
            <Message size={13} /> Open conversation
          </button>
          <button role="menuitem" className="is-danger" onClick={() => deleteContact(contactMenu.contactId)}>
            <Trash size={13} /> Delete contact
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * Rail
 * ================================================================== */

function RailBtn({
  children, label, active, badge, onClick,
}: {
  children: ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <button className="inst-rail-btn" aria-current={active ? 'page' : undefined} aria-label={label} title={label} onClick={onClick}>
      {children}
      {!!badge && <span className="inst-rail-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

function MoreIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function KantMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity="0.5" />
      <path d="M9 8v8M9 12l5-4M9 12l5 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ================================================================== *
 * List rows
 * ================================================================== */

function FilterChip({
  id, active, set, count, children,
}: {
  id: 'all' | 'unread' | 'unverified';
  active: string;
  set: (v: 'all' | 'unread' | 'unverified') => void;
  count: number;
  children: ReactNode;
}) {
  return (
    <button className="chip" aria-pressed={active === id} onClick={() => set(id)}>
      {children}
      <span className="chip-count">{count}</span>
    </button>
  );
}

function filterContacts(list: Contact[], query: string, filter: string): Contact[] {
  const q = query.trim().toLowerCase();
  let out = list;
  if (q) out = out.filter((c) => (c.nickname ?? '').toLowerCase().includes(q) || c.publicKeyHex.toLowerCase().includes(q));
  if (filter === 'unread') out = out.filter((c) => c.unread);
  if (filter === 'unverified') out = out.filter((c) => c.trust !== 'verified');
  return [...out].sort(
    (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0),
  );
}

function unreadTotal(list: Contact[]) {
  return list.reduce((a, c) => a + (c.unread ?? 0), 0);
}

function ContactRows({
  contacts, selected, onSelect, onContextMenu, query, onAdd,
}: {
  contacts: Contact[];
  selected: string | null;
  onSelect: (hex: string) => void;
  onContextMenu: (event: ReactMouseEvent, contactId: string) => void;
  query: string;
  onAdd?: () => void;
}) {
  if (contacts.length === 0) {
    return (
      <div className="empty" style={{ padding: 'var(--s-9) var(--s-6)' }}>
        <div className="empty-mark"><Search size={16} /></div>
        <div className="empty-title">{query ? 'No matches' : 'No contacts yet'}</div>
        <div className="empty-text">
          {query ? <>Nothing matches “{query}”.</> : 'Add someone with their public key to start a conversation.'}
        </div>
        {!query && onAdd && (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={onAdd}>
            <Plus size={12} /> Add contact
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {contacts.map((c) => (
        <button
          key={c.id}
          className={`row${c.unread ? ' is-unread' : ''}`}
          role="option"
          aria-selected={selected === c.id}
          onClick={() => onSelect(c.id!)}
          onContextMenu={(event) => onContextMenu(event, c.id!)}
        >
          <Avatar contact={c} size={34} />
          <span className="row-body">
            <span className="row-top">
              <span className="row-name">{displayName(c)}</span>
              {c.trust === 'verified' && <ShieldCheck size={12} color="var(--trust-verified)" />}
              {c.trust === 'changed' && <ShieldAlert size={12} color="var(--trust-broken)" />}
              {c.lastMessageTs && <span className="row-time">{listStamp(c.lastMessageTs)}</span>}
            </span>
            <span className="row-preview">
              <span className="row-msg">{c.lastMessage ?? 'No messages yet'}</span>
              {!!c.unread && <span className="row-unread">{c.unread}</span>}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

function GroupRows({
  groups, selected, onSelect, onCreate,
}: {
  groups: Group[]; selected: string | null; onSelect: (id: string) => void; onCreate?: () => void;
}) {
  if (!groups.length) {
    return (
      <div className="empty" style={{ padding: 'var(--s-9) var(--s-6)' }}>
        <div className="empty-mark"><Users size={16} /></div>
        <div className="empty-title">No groups</div>
        <div className="empty-text">Create a group to message several people at once. Everyone in it has to be a contact first.</div>
        {onCreate && (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={onCreate}>
            <Plus size={12} /> New group
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <button key={g.id} className={`row${g.unread ? ' is-unread' : ''}`} role="option" aria-selected={selected === g.id} onClick={() => onSelect(g.id)}>
          <span className="avatar avatar-group"><Users size={16} /></span>
          <span className="row-body">
            <span className="row-top">
              <span className="row-name">{g.name}</span>
              {g.lastMessageTs && <span className="row-time">{listStamp(g.lastMessageTs)}</span>}
            </span>
            <span className="row-preview">
              <span className="row-msg">{g.lastMessage}</span>
              {!!g.unread && <span className="row-unread">{g.unread}</span>}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

/* ================================================================== *
 * Conversation
 * ================================================================== */

function Conversation({
  contact, status, hops, scenario, ackedKeyChange, onAckKeyChange, onVerify, onBack, onToggleDrawer,
}: {
  contact: Contact;
  status: NodeStatus;
  hops: RouteHop[];
  scenario: Scenario;
  ackedKeyChange: boolean;
  onAckKeyChange: () => void;
  onVerify: () => void;
  onBack: () => void;
  onToggleDrawer: () => void;
}) {
  const store = useStore();
  const base = store.state.threads[contact.id!] ?? [];
  const messages: PlainMessage[] = useMemo(() => {
    if (scenario !== 'send-failed') return base;
    return [
      ...base,
      { id: 'failed', from: 'me', ts: Date.now() - 30_000, text: 'did the cert renewal go through?', status: 'failed' },
    ];
  }, [base, scenario]);

  const showKeyChange = contact.trust === 'changed' && !ackedKeyChange;
  const offline = status === 'offline' || status === 'connecting' || status === 'error';
  const [msgMenu, setMsgMenu] = useState<MessageMenu | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTo>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useAutoScroll(bodyRef, [messages.length]);

  const openMsgMenu = useCallback((e: { clientX: number; clientY: number }, msg: PlainMessage) => {
    setMsgMenu({
      messageId: msg.id,
      text: msg.text,
      x: Math.min(e.clientX, window.innerWidth - 160),
      y: Math.min(e.clientY, window.innerHeight - 80),
    });
  }, []);

  useEffect(() => {
    const close = () => setMsgMenu(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, []);

  return (
    <>
      <header className="inst-head">
        <button className="btn btn-ghost btn-icon only-mobile" onClick={onBack} aria-label="Back to list">
          <ChevronLeft size={16} />
        </button>
        <Avatar contact={contact} size={30} />
        <div style={{ minWidth: 0 }}>
          <div className="inst-head-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {displayName(contact)}
            <TrustBadge trust={contact.trust} showLabel={false} />
          </div>
          <div className="inst-head-sub">
            {contact.online ? 'Online' : contact.lastSeen ? `Last seen ${relativeSeen(contact.lastSeen)}` : 'Offline'}
          </div>
        </div>
        <div className="inst-head-spacer" />
        {contact.trust !== 'verified' && (
          <button className="btn btn-secondary btn-sm" onClick={onVerify}><Shield size={12} /> Verify</button>
        )}
        <button className="btn btn-ghost btn-icon" onClick={onToggleDrawer} aria-label="Contact detail">
          <QR size={15} />
        </button>
      </header>

      {/* The signature: the live path, pinned right under the header. */}
      <RouteSpine hops={hops} status={status} peerLabel={displayName(contact)} />

      {showKeyChange && (
        <div style={{ padding: 'var(--s-6) var(--s-8) 0' }}>
          <div className="banner banner-danger" role="alert">
            <ShieldAlert size={18} color="var(--sig-red-9)" />
            <div className="banner-body">
              <div className="banner-title">{displayName(contact)}’s key changed</div>
              <div className="banner-text">
                {contact.verifiedAt
                  ? `You verified this contact on ${new Date(contact.verifiedAt).toLocaleDateString([], { day: 'numeric', month: 'long' })}. `
                  : 'You had verified this contact. '}
                The key they are using now is different. That happens when someone reinstalls or switches device —
                and it is also exactly what an impersonation attempt looks like. Anything you send now is encrypted
                to the new key.
              </div>
              <div className="banner-actions">
                <button className="btn btn-danger btn-sm" onClick={onVerify}>Compare fingerprints</button>
                <button className="btn btn-ghost btn-sm" onClick={onAckKeyChange}>Not now</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="empty">
          <div className="empty-mark"><LockIcon size={16} /></div>
          <div className="empty-title">No messages yet</div>
          <div className="empty-text">
            {contact.circuitAddr
              ? 'Say something. Messages are encrypted end to end and exist only on your two devices.'
              : `You have ${displayName(contact)}’s key but no address to reach them. They need to come online on a relay you can both see.`}
          </div>
        </div>
      ) : (
        <div className="conv-body" ref={bodyRef} onMouseDown={() => setMsgMenu(null)}>
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const showDay = !prev || !sameDay(prev.ts, m.ts);
            const grouped = !!prev && prev.from === m.from && m.ts - prev.ts < 5 * 60_000 && !showDay;
            const lastOfGroup = !next || next.from !== m.from || next.ts - m.ts >= 5 * 60_000;

            if (m.system === 'key-changed') {
              return (
                <div key={m.id} style={{ display: 'contents' }}>
                  {showDay && <div className="day"><span>{dayLabel(m.ts)}</span></div>}
                  <div className="sysmsg"><ShieldAlert size={13} /> Key changed at {formatTime(m.ts)}</div>
                </div>
              );
            }

            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <div className="day"><span>{dayLabel(m.ts)}</span></div>}
                <MessageBubble
                  m={m}
                  grouped={grouped}
                  lastOfGroup={lastOfGroup}
                  contact={contact}
                  onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, m); }}
                  onLongPress={(pos) => openMsgMenu(pos, m)}
                  onRetry={() => store.send(contact.id!, m.text)}
                />
              </div>
            );
          })}
        </div>
      )}

      <Composer
        disabled={offline}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={(text) => { store.send(contact.id!, text, replyTo ?? undefined); setReplyTo(null); }}
        onSendFile={(f) => store.sendFile?.(contact.id!, f)}
      />

      {msgMenu && (
        <div
          className="conversation-menu"
          role="menu"
          style={{ left: msgMenu.x, top: msgMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button role="menuitem" onClick={() => {
            const msg = messages.find(m => m.id === msgMenu.messageId);
            if (msg) setReplyTo({ id: msg.id, text: msg.text, from: msg.from === 'me' ? 'You' : (contact.nickname ?? contact.publicKeyHex.slice(0, 12)) });
            setMsgMenu(null);
          }}>
            <ArrowRight size={13} /> Reply
          </button>
          <button role="menuitem" onClick={() => { copyText(msgMenu.text); setMsgMenu(null); }}>
            <Copy size={13} /> Copy
          </button>
        </div>
      )}
    </>
  );
}

function MessageBubble({
  m, grouped, lastOfGroup, contact, onContextMenu, onLongPress, onRetry,
}: {
  m: PlainMessage;
  grouped: boolean;
  lastOfGroup: boolean;
  contact: Contact;
  onContextMenu: (e: ReactMouseEvent) => void;
  onLongPress: (pos: { clientX: number; clientY: number }) => void;
  onRetry: () => void;
}) {
  // Deliberately no touch-hold timer here: it used to fire on the exact same
  // press-and-hold gesture the OS uses to start native text selection, so
  // selecting a word or a phrase to copy never got a chance to start — the
  // app's own menu always won the race. A dedicated tap target for the menu
  // leaves long-press free for native selection (which is how you copy part
  // of a message on mobile).
  return (
    <div
      className={`msg ${m.from === 'me' ? 'out' : 'in'}${grouped ? ' grouped' : ''}${m.status === 'failed' ? ' msg-failed' : ''}`}
      onContextMenu={onContextMenu}
    >
      <div className="bubble">
        {m.replyTo && (
          <div className="msg-quote">
            <span className="msg-quote-name">{m.replyTo.from}</span>
            <span className="msg-quote-text">{m.replyTo.text.slice(0, 120)}{m.replyTo.text.length > 120 ? '…' : ''}</span>
          </div>
        )}
        {m.text}
        {m.attachments?.map((a) => <AttachmentView attachment={a} key={a.fileId ?? a.name} />)}
        <button
          className="msg-menu-btn"
          aria-label="Message actions"
          onClick={(e) => onLongPress({ clientX: e.clientX, clientY: e.clientY })}
        >
          <MoreIcon size={13} />
        </button>
      </div>
      {lastOfGroup && (
        <div className="msg-meta">
          <span>{formatTime(m.ts)}</span>
          {m.expiresAt && <><Clock size={10} /><span>{expiryLabel(m.expiresAt)}</span></>}
          {m.from === 'me' && <StatusIcon status={m.status} />}
          {m.from === 'me' && <SpineMini hops={m.route} />}
        </div>
      )}
      {m.status === 'failed' && (
        <div className="msg-meta" style={{ color: 'var(--sig-red-9)' }}>
          <Alert size={10} /> Not delivered — no route to {displayName(contact)}.
          <button className="btn btn-ghost" style={{ height: 18, padding: '0 6px', color: 'var(--sig-red-9)', fontSize: 10 }} onClick={onRetry}>Retry</button>
        </div>
      )}
    </div>
  );
}

function AttachmentView({ attachment }: { attachment: MessageAttachment }) {
  const store = useStore();
  const [url, setUrl] = useState<string | null>(attachment.thumbnail ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const isImage = attachment.mime.startsWith('image/');

  const load = useCallback(async () => {
    if (objectUrlRef.current) return objectUrlRef.current;
    if (!attachment.fileId || !store.loadAttachment) return null;
    setLoading(true);
    setError(false);
    try {
      const next = await store.loadAttachment(attachment);
      if (next) {
        objectUrlRef.current = next;
        setUrl(next);
      } else {
        setError(true);
      }
      return next;
    } catch {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [attachment, store.loadAttachment]);

  useEffect(() => {
    if (isImage && attachment.fileId && !objectUrlRef.current) void load();
    // Loading is keyed by the encrypted blob id. Store status updates must not
    // revoke and decrypt the same image again on every live network render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage, attachment.fileId]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [attachment.fileId]);

  const download = useCallback(async () => {
    if (store.downloadAttachment) {
      const saved = await store.downloadAttachment(attachment);
      if (!saved) setError(true);
      return;
    }
    const href = objectUrlRef.current ?? await load();
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.download = attachment.name || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [attachment, load, store.downloadAttachment]);

  return (
    <div className={`attach${isImage ? ' attach-image' : ''}`}>
      {isImage && url && <img className="attach-preview" src={url} alt={attachment.name} />}
      {!isImage && <Paperclip size={14} color="var(--fg-tertiary)" />}
      <div className="attach-info">
        <div className="attach-name">{attachment.name || 'Unnamed attachment'}</div>
        <div className="attach-size">{error ? 'Unable to open' : loading ? 'Decrypting…' : fileSize(attachment.size)}</div>
      </div>
      <button className="btn btn-ghost btn-icon" aria-label={`Download ${attachment.name || 'attachment'}`} onClick={() => void download()} disabled={loading}>
        {loading ? <Spinner size={13} /> : <Download size={13} />}
      </button>
    </div>
  );
}

function GroupConversation({
  groupId, status, hops, onBack,
}: {
  groupId: string; status: NodeStatus; hops: RouteHop[]; onBack: () => void;
}) {
  const store = useStore();
  const group = store.state.groups.find((g) => g.id === groupId);
  const messages = store.state.groupThreads[groupId] ?? [];
  if (!group) return null;
  const offline = status === 'offline' || status === 'connecting' || status === 'error';
  const [msgMenu, setMsgMenu] = useState<MessageMenu | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTo>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useAutoScroll(bodyRef, [messages.length]);

  const openMsgMenu = useCallback((e: { clientX: number; clientY: number }, msg: PlainMessage) => {
    setMsgMenu({
      messageId: msg.id,
      text: msg.text,
      x: Math.min(e.clientX, window.innerWidth - 160),
      y: Math.min(e.clientY, window.innerHeight - 80),
    });
  }, []);

  return (
    <>
      <header className="inst-head">
        <button className="btn btn-ghost btn-icon only-mobile" onClick={onBack} aria-label="Back to list">
          <ChevronLeft size={16} />
        </button>
        <span className="avatar avatar-group" style={{ width: 30, height: 30 }}><Users size={15} /></span>
        <div>
          <div className="inst-head-title">{group.name}</div>
          <div className="inst-head-sub">{group.memberKeys.length} members</div>
        </div>
      </header>

      <RouteSpine hops={hops} status={status} peerLabel={group.name} />

      <div className="conv-body" ref={bodyRef} onMouseDown={() => setMsgMenu(null)}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || !sameDay(prev.ts, m.ts);
          const sender = store.state.contacts.find((c) => c.publicKeyHex === m.from);
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div className="day"><span>{dayLabel(m.ts)}</span></div>}
              <div
                className={`msg ${m.from === 'me' ? 'out' : 'in'}`}
                onContextMenu={(e) => { e.preventDefault(); openMsgMenu(e, m); }}
              >
                {m.from !== 'me' && sender && (
                  <div className="msg-sender">
                    <Glyph hex={sender.publicKeyHex} size={14} />
                    <span>{displayName(sender)}</span>
                    {sender.trust === 'verified' && <ShieldCheck size={10} color="var(--trust-verified)" />}
                  </div>
                )}
                <div className="bubble">
                  {m.replyTo && (
                    <div className="msg-quote">
                      <span className="msg-quote-name">{m.replyTo.from}</span>
                      <span className="msg-quote-text">{m.replyTo.text.slice(0, 120)}{m.replyTo.text.length > 120 ? '…' : ''}</span>
                    </div>
                  )}
                  {m.text}
                  {m.attachments?.map((a) => <AttachmentView attachment={a} key={a.fileId ?? a.name} />)}
                  <button
                    className="msg-menu-btn"
                    aria-label="Message actions"
                    onClick={(e) => openMsgMenu(e, m)}
                  >
                    <MoreIcon size={13} />
                  </button>
                </div>
                <div className="msg-meta">
                  <span>{formatTime(m.ts)}</span>
                  {m.expiresAt && <><Clock size={10} /><span>{expiryLabel(m.expiresAt)}</span></>}
                  {m.from === 'me' && <StatusIcon status={m.status} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Composer
        disabled={offline}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={(text) => { store.sendGroup?.(groupId, text, replyTo ?? undefined); setReplyTo(null); }}
        onSendFile={(f) => store.sendGroupFile?.(groupId, f)}
      />

      {msgMenu && (
        <div
          className="conversation-menu"
          role="menu"
          style={{ left: msgMenu.x, top: msgMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button role="menuitem" onClick={() => {
            const msg = messages.find(m => m.id === msgMenu.messageId);
            if (msg) {
              const senderContact = store.state.contacts.find(c => c.publicKeyHex === msg.from);
              setReplyTo({ id: msg.id, text: msg.text, from: msg.from === 'me' ? 'You' : (senderContact ? displayName(senderContact) : 'them') });
            }
            setMsgMenu(null);
          }}>
            <ArrowRight size={13} /> Reply
          </button>
          <button role="menuitem" onClick={() => { copyText(msgMenu.text); setMsgMenu(null); }}>
            <Copy size={13} /> Copy
          </button>
        </div>
      )}
    </>
  );
}

function StatusIcon({ status }: { status: PlainMessage['status'] }) {
  if (status === 'pending') return <Spinner size={10} color="var(--fg-tertiary)" />;
  if (status === 'sent') return <Check size={11} color="var(--fg-tertiary)" />;
  if (status === 'delivered') return <DoubleCheck size={11} color="var(--fg-tertiary)" />;
  if (status === 'read') return <DoubleCheck size={11} color="var(--accent)" />;
  if (status === 'failed') return <Alert size={10} color="var(--sig-red-9)" />;
  return null;
}

function Composer({
  disabled, onSend, onSendFile, replyTo, onCancelReply,
}: {
  disabled?: boolean;
  onSend?: (text: string) => void;
  onSendFile?: (file: File) => void;
  replyTo?: ReplyTo;
  onCancelReply?: () => void;
}) {
  const [value, setValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const submit = () => {
    const text = value.trim();
    if (!text || !onSend) return;
    onSend(text);
    setValue('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
  };

  return (
    <div className="composer">
      {replyTo && (
        <div className="composer-reply">
          <div className="composer-reply-body">
            <span className="composer-reply-name">{replyTo.from}</span>
            <span className="composer-reply-text">{replyTo.text.slice(0, 80)}{replyTo.text.length > 80 ? '…' : ''}</span>
          </div>
          <button className="btn btn-ghost btn-icon" style={{ width: 24, height: 24 }} aria-label="Cancel reply" onClick={onCancelReply}>
            <X size={12} />
          </button>
        </div>
      )}
      <div className="composer-box">
        <input ref={fileRef} type="file" hidden accept="*/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f && onSendFile) onSendFile(f); e.target.value = ''; }} />
        <button className="btn btn-ghost btn-icon" aria-label="Attach a file" disabled={disabled}
          onClick={() => fileRef.current?.click()}>
          <Paperclip size={15} />
        </button>
        <textarea
          ref={textareaRef}
          className="composer-input"
          rows={1}
          placeholder={disabled ? 'Connect to send messages' : 'Write a message'}
          value={value}
          disabled={disabled}
          aria-label="Message"
          onChange={(e) => {
            setValue(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <button className="btn btn-primary btn-icon" aria-label="Send" disabled={disabled || !value.trim()} onClick={submit}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Get started — replaces the dead 980px void on first run
 * ================================================================== */

function GetStarted({ onConnect, onAdd, status, meHex }: { onConnect: () => void; onAdd: () => void; status: NodeStatus; meHex: string }) {
  const store = useStore();
  const words = store.identity(meHex)?.words ?? [];
  return (
    <div className="getstarted">
      <div className="getstarted-inner anim-rise">
        <div className="t-label" style={{ marginBottom: 10 }}>First run</div>
        <h1 className="t-display" style={{ marginBottom: 10 }}>Your identity exists only on this device</h1>
        <p className="getstarted-lede">
          There is no account or central identity service holding it. Two things left: get on a relay so people can reach you,
          and give someone your key.
        </p>

        <ol className="steps">
          <Step
            n={1}
            title="Connect to a relay"
            done={status !== 'offline'}
            body="A relay passes encrypted traffic between people who cannot reach each other directly. It never sees message contents."
          >
            <button className="btn btn-primary" onClick={onConnect}>
              {status === 'offline' ? 'Connect' : 'Connected'} <ArrowRight size={13} />
            </button>
          </Step>

          <Step n={2} title="Share your key" body="Anyone with this can start an encrypted conversation with you. It is safe to post publicly.">
            <div className="step-glyph-row">
              <div className="step-glyph"><Glyph hex={meHex} size={54} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-label" style={{ marginBottom: 6 }}>Your fingerprint</div>
                <div className="word-pills">
                  {words.map((w, i) => <span key={i} className="word-pill mono">{w}</span>)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => copyText(meHex)}><Copy size={12} /> Copy key</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyText(meHex)} title="Copies your key; QR sharing is not available in this build"><QR size={12} /> Copy key</button>
                </div>
              </div>
            </div>
          </Step>

          <Step n={3} title="Add someone" body="Paste a friend’s key. You can compare fingerprints later to confirm it is really them.">
            <button className="btn btn-secondary" onClick={onAdd}><Plus size={13} /> Add contact</button>
          </Step>
        </ol>
      </div>
    </div>
  );
}

function Step({
  n, title, body, done, children,
}: {
  n: number; title: string; body: string; done?: boolean; children?: ReactNode;
}) {
  return (
    <li className="card step">
      <span className={`step-n${done ? ' is-done' : ''} mono`}>
        {done ? <Check size={12} color="var(--trust-verified)" /> : n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-heading" style={{ marginBottom: 4 }}>{title}</div>
        <div className="step-body">{body}</div>
        {children}
      </div>
    </li>
  );
}

/* ================================================================== *
 * Verify ceremony
 *
 * The fix for the failure Signal is criticised for: success and failure both flash past a
 * single "mark verified" tap, so people confirm on autopilot. Here the two outcomes are
 * separate buttons with different weight and different consequences, and neither is the
 * default action.
 * ================================================================== */

function VerifySheet({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const store = useStore();
  const [mode, setMode] = useState<'words' | 'qr' | 'raw'>('words');
  const [result, setResult] = useState<'none' | 'ok' | 'no'>('none');
  /* The SYMMETRIC fingerprint over both identity keys — so the other device shows exactly
     these eight words. Derived once in the store and cached. */
  const words = store.ceremonyWords(contact.id!) ?? [];

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Verify ${displayName(contact)}`}>
        <header className="modal-head">
          <Shield size={17} color="var(--fg-secondary)" />
          <div style={{ flex: 1 }}>
            <div className="t-heading">Verify {displayName(contact)}</div>
            <div className="t-caption">Compare these out loud, in person or on a call you already trust.</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </header>

        <div className="modal-body">
          {result === 'none' && (
            <>
              <div className="inst-filters" style={{ padding: 0, border: 0, marginBottom: 16 }}>
                <button className="chip" aria-pressed={mode === 'words'} onClick={() => setMode('words')}>Words</button>
                <button className="chip" aria-pressed={mode === 'qr'} onClick={() => setMode('qr')}>QR</button>
                <button className="chip" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw key</button>
              </div>

              {mode === 'words' && (
                <>
                  <div className="t-label" style={{ marginBottom: 8 }}>
                    Your conversation with {displayName(contact)}
                  </div>
                  <Fingerprint words={words} />
                  <p className="modal-note">
                    {displayName(contact)} sees these same eight words on their device — the value is computed from
                    both of your identity keys, so it is one comparison, not two. All eight must match, in order.
                    Substitutions land in the middle of the list, not at the ends, so read every one.
                  </p>
                </>
              )}

              {mode === 'qr' && (
                <div style={{ display: 'grid', placeItems: 'center', padding: '20px 0' }}>
                  <FakeQR hex={contact.publicKeyHex} />
                  <p className="modal-note" style={{ textAlign: 'center', maxWidth: '40ch' }}>
                    Have them scan this from your screen. Scanning proves nothing by itself — you still confirm the
                    result below.
                  </p>
                </div>
              )}

              {mode === 'raw' && (
                <>
                  <div className="t-label" style={{ marginBottom: 8 }}>Ed25519 public key</div>
                  <div className="keyblock">{groupedKey(contact.publicKeyHex)}</div>
                  <p className="modal-note">
                    The words above encode this key. Comparing hex directly is measurably harder to do reliably — it
                    is here because hiding it would be dishonest, not because it is the better method.
                  </p>
                </>
              )}

              {contact.trust === 'changed' && (
                <div className="banner banner-danger" style={{ marginTop: 16 }}>
                  <ShieldAlert size={16} color="var(--sig-red-9)" />
                  <div className="banner-body">
                    <div className="banner-title">This is not the key you verified</div>
                    <div className="banner-text">If they did not just reinstall or change device, stop and reach them another way.</div>
                  </div>
                </div>
              )}
            </>
          )}

          {result === 'ok' && (
            <div className="verify-result">
              <ShieldCheck size={40} color="var(--trust-verified)" />
              <div className="t-title">{displayName(contact)} is verified</div>
              <p>This holds until their key changes. If it does, you get a warning before you can send anything else.</p>
            </div>
          )}

          {result === 'no' && (
            <div className="verify-result">
              <ShieldAlert size={40} color="var(--trust-broken)" />
              <div className="t-title">Marked as not matching</div>
              <p>
                Do not send anything sensitive to this contact. Reach them on a different channel and get their key
                again — the one you have may not be theirs.
              </p>
            </div>
          )}
        </div>

        <footer className="modal-foot">
          {result === 'none' ? (
            <>
              {/* Two outcomes, two buttons, different weight, neither pre-selected. */}
              <button
                className="btn btn-danger-quiet"
                onClick={() => { store.setTrust(contact.id!, 'unverified'); setResult('no'); }}
              >
                They don’t match
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => { store.setTrust(contact.id!, 'verified'); setResult('ok'); }}
              >
                <ShieldCheck size={13} /> All eight match
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** A deterministic QR-looking block. Not a real QR — this is a design prototype. */
function FakeQR({ hex }: { hex: string }) {
  const n = 21;
  const cells: boolean[] = [];
  for (let i = 0; i < n * n; i++) {
    const c = parseInt(hex[i % hex.length], 16);
    cells.push(((c >> (i % 4)) & 1) === 1);
  }
  const isFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 'var(--r-3)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 6px)` }} role="img" aria-label="QR code containing this public key">
        {cells.map((on, i) => {
          const r = Math.floor(i / n), c = i % n;
          const fin = isFinder(r, c);
          const fr = r % 7, fc = c % 7;
          const finOn = fin && (fr === 0 || fr === 6 || fc === 0 || fc === 6 || (fr >= 2 && fr <= 4 && fc >= 2 && fc <= 4));
          return <div key={i} style={{ width: 6, height: 6, background: (fin ? finOn : on) ? '#000' : '#fff' }} />;
        })}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Contact detail drawer
 * ================================================================== */

function ContactDetail({ contact, onVerify, onClose }: { contact: Contact; onVerify: () => void; onClose: () => void }) {
  const store = useStore();
  const [showRaw, setShowRaw] = useState(false);
  const words = store.ceremonyWords(contact.id!) ?? [];
  return (
    <div style={{ padding: 'var(--s-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <div className="t-label">Contact</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close panel"><X size={13} /></button>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', gap: 12, marginBottom: 22 }}>
        <Glyph hex={contact.publicKeyHex} size={72} />
        <div style={{ textAlign: 'center' }}>
          <div className="t-title">{displayName(contact)}</div>
          <div className="t-caption">
            {contact.online ? 'Online now' : contact.lastSeen ? `Last seen ${relativeSeen(contact.lastSeen)}` : 'Offline'}
          </div>
        </div>
        <TrustBadge trust={contact.trust} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingTop: 'var(--s-5)' }}>
          <div>
            <div className="t-label" style={{ marginBottom: 8 }}>Fingerprint for this conversation</div>
            <Fingerprint words={words} />
          </div>
          <div className="setting-desc">{TRUST_COPY[contact.trust].long}</div>
          {contact.trust !== 'verified' && (
            <button className="btn btn-primary btn-block" onClick={onVerify}>
              <Shield size={13} /> Verify {displayName(contact)}
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingTop: 'var(--s-5)' }}>
          <div className="setting-row" style={{ padding: 0 }}>
            <div className="setting-body">
              <div className="setting-name">Raw public key</div>
              <div className="setting-desc">Ed25519, hex encoded</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}>
              {showRaw ? 'Hide' : 'Show'}
            </button>
          </div>
          {showRaw && <div className="keyblock">{groupedKey(contact.publicKeyHex)}</div>}
          {contact.circuitAddr && (
            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>Circuit address</div>
              <div className="keyblock" style={{ fontSize: 10.5 }}>{contact.circuitAddr}</div>
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-danger-quiet btn-block" onClick={() => { store.removeContact(contact.id!); onClose(); }}>
        <Trash size={13} /> Remove contact
      </button>
    </div>
  );
}

/* ================================================================== *
 * Peers
 * ================================================================== */

function PeersPane({ status }: { status: NodeStatus }) {
  const store = useStore();
  const peers = store.state.peers;

  if (status === 'offline' || status === 'error') {
    return (
      <div className="empty" style={{ padding: 'var(--s-9) var(--s-6)' }}>
        <div className="empty-mark"><Globe size={16} /></div>
        <div className="empty-title">Not connected</div>
        <div className="empty-text">Peers on your relay show up here automatically once you connect.</div>
      </div>
    );
  }

  if (peers.length === 0) {
    return (
      <div className="empty" style={{ padding: 'var(--s-9) var(--s-6)' }}>
        <div className="empty-mark"><Globe size={16} /></div>
        <div className="empty-title">No peers yet</div>
        <div className="empty-text">Other nodes on your relay appear here as they are discovered. It can take a moment after connecting.</div>
      </div>
    );
  }

  return (
    <div className="inst-rows">
      {peers.map((p) => (
        <div key={p.peerId} className="row" style={{ cursor: 'default' }}>
          <span className="spine-dot hop" style={{ marginLeft: 6 }} />
          <span className="row-body">
            <span className="row-top">
              <span className="row-name mono" style={{ fontSize: 11.5 }}>{p.peerId.slice(0, 16)}…</span>
            </span>
            <span className="row-msg">Not one of your contacts — a verified fingerprint is the only way to know who this is.</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PeersDetail({ status }: { status: NodeStatus }) {
  return (
    <div className="empty">
      <div className="empty-mark"><Globe size={18} /></div>
      <div className="empty-title">Peers on your relay</div>
      <div className="empty-text">
        {status === 'offline' || status === 'error'
          ? 'Connect to see who else is reachable.'
          : 'These are libp2p peer IDs, not Kant identities. Seeing someone here does not tell you which contact they are — only a verified fingerprint does that.'}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Debug
 * ================================================================== */

function DebugPane({ status }: { status: NodeStatus }) {
  const { state } = useStore();
  return (
    <div className="inst-rows">
      <div className="settings">
        <section className="card">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile"><Command size={14} /></span>
            <div>
              <div className="card-title">Live diagnostics</div>
              <div className="card-desc">Network and protocol events from this session</div>
            </div>
          </div>
          <div className="card-body">
            <div className="setting-row" style={{ paddingTop: 0 }}>
              <div className="setting-body">
                <div className="setting-name">Status</div>
                <div className="setting-desc">{STATUS_COPY[status].label}</div>
              </div>
              <span className={`status-led led-${status}`} />
            </div>
            <div className="setting-row">
              <div className="setting-body">
                <div className="setting-name">Events</div>
                <div className="setting-desc">{state.debugLog.length} lines captured</div>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-body">
                <div className="setting-name">Relay</div>
                <div className="setting-desc mono debug-break">{state.settings.relay}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function DebugDetail({ status }: { status: NodeStatus }) {
  const { state } = useStore();
  const endRef = useRef<HTMLDivElement | null>(null);
  const logText = state.debugLog.length ? state.debugLog.join('\n') : 'No debug events yet.';

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [state.debugLog.length]);

  return (
    <div className="debug-window">
      <header className="inst-head">
        <div>
          <div className="inst-head-title">Debug window</div>
          <div className="inst-head-sub">{STATUS_COPY[status].label} · updates live</div>
        </div>
        <div className="inst-head-spacer" />
        <button className="btn btn-secondary btn-sm" onClick={() => copyText(logText)}>
          <Copy size={12} /> Copy logs
        </button>
      </header>
      <div className="debug-summary">
        <span><b>Status</b> {status}</span>
        <span><b>Relay</b> {state.settings.relay}</span>
        <span><b>Circuit</b> {state.circuitAddr || 'not reserved'}</span>
        <span><b>Peers</b> {state.peers.length}</span>
      </div>
      <div className="debug-log" role="log" aria-live="polite" aria-label="Kant debug log">
        {state.debugLog.length
          ? state.debugLog.map((line, index) => <div key={`${index}-${line}`}><span>{String(index + 1).padStart(3, '0')}</span>{line}</div>)
          : <div><span>000</span>No debug events yet.</div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/* ================================================================== *
 * Settings
 * ================================================================== */

function SettingsPane({ status }: { status: NodeStatus }) {
  const store = useStore();
  const { settings, meHex, circuitAddr } = store.state;
  const [relay, setRelay] = useState(settings.relay);
  const words = store.identity(meHex)?.words ?? [];

  return (
    /* The old build clipped this behind a fixed footer. There is no fixed footer here, and
       the scroller carries its own bottom padding. */
    <div className="inst-rows">
      <div className="settings">
        {/* First, because it is the only thing here that silently stops
            messages arriving — and because on mobile this pane is the whole of
            Settings, the detail pane beside it never being reachable. Renders
            nothing off Android. */}
        <DeliveryHealth />

        <section className="card">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile"><Globe size={14} /></span>
            <div>
              <div className="card-title">Network</div>
              <div className="card-desc">How you reach other people</div>
            </div>
          </div>
          <div className="card-body">
            <div className="field">
              <label className="field-label" htmlFor="relay-url">Relay URL</label>
              <div className="input-wrap">
                <input id="relay-url" className="input mono" value={relay} onChange={(e) => setRelay(e.target.value)} spellCheck={false} />
              </div>
              <span className="field-hint">Must be reachable from the internet. A LAN address only works on your own network.</span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => { store.setSettings({ relay }); store.connect(); }}
            >
              Apply and reconnect
            </button>

            <div className="setting-row">
              <div className="setting-body">
                <div className="setting-name">Onion routing</div>
                <div className="setting-desc">
                  Route through other peers to reduce what an individual forwarding peer can link. Costs latency,
                  needs at least one other peer online, and does not hide relay-registry lookups.
                </div>
              </div>
              <button className="toggle" role="switch" aria-checked={settings.onion} aria-label="Onion routing" onClick={() => store.setSettings({ onion: !settings.onion })} />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile"><Command size={14} /></span>
            <div>
              <div className="card-title">Interface</div>
              <div className="card-desc">How the app looks and fits</div>
            </div>
          </div>
          <div className="card-body">
            <div className="setting-row" style={{ paddingTop: 0 }}>
              <div className="setting-body">
                <div className="setting-name">Density</div>
                <div className="setting-desc">Compact fits about a third more conversations on screen.</div>
              </div>
              <div className="inst-filters" style={{ padding: 0, border: 0 }}>
                <button className="chip" aria-pressed={settings.density === 'comfortable'} onClick={() => store.setSettings({ density: 'comfortable' })}>Comfortable</button>
                <button className="chip" aria-pressed={settings.density === 'compact'} onClick={() => store.setSettings({ density: 'compact' })}>Compact</button>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile"><Shield size={14} /></span>
            <div>
              <div className="card-title">Identity</div>
              <div className="card-desc">Your keypair</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Glyph hex={meHex} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="setting-name">you</div>
                <ShortKey hex={meHex} />
              </div>
            </div>
            <div className="t-caption" style={{ marginTop: -4 }}>
              Your key as words — for sharing, so someone can add you. This is not the value you compare
              during verification; that one is per-conversation.
            </div>
            <Fingerprint words={words} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => copyText(meHex)}><Copy size={12} /> Copy key</button>
              <button className="btn btn-ghost btn-sm" onClick={() => copyText(meHex)} title="Copies your key; QR sharing is not available in this build"><QR size={12} /> Copy key</button>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="field-label" htmlFor="my-circuit">Your circuit address</label>
              <div className="input-wrap">
                <input
                  id="my-circuit"
                  className="input mono"
                  readOnly
                  value={circuitAddr || 'Connect to a relay to get your address'}
                  onFocus={(e) => e.target.select()}
                  spellCheck={false}
                />
              </div>
              <span className="field-hint">
                Send this together with your key to a friend — it lets them reach you even when you are on
                different relays. Kant keeps it updated automatically.
              </span>
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 8 }}
                disabled={!circuitAddr}
                onClick={() => copyText(circuitAddr)}
              >
                <Copy size={12} /> Copy circuit
              </button>
            </div>
          </div>
        </section>

        <section className="card danger">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile is-danger"><Alert size={14} /></span>
            <div>
              <div className="card-title" style={{ color: 'var(--sig-red-9)' }}>Danger zone</div>
              <div className="card-desc">Cannot be undone</div>
            </div>
          </div>
          <div className="card-body">
            <div className="setting-desc">
              Wiping erases your keypair, every conversation and every contact from this device. There is no server
              copy and no recovery phrase.
            </div>
            <button className="btn btn-danger-quiet" style={{ alignSelf: 'flex-start' }} onClick={store.reset}>
              <Trash size={13} /> Wipe this device
            </button>
          </div>
        </section>

        <div className="settings-foot">
          <span className={`status-led led-${status}`} />
          <span className="t-caption">{STATUS_COPY[status].label} · Kant 2.0</span>
        </div>
      </div>
    </div>
  );
}

function SettingsDetail({ status }: { status: NodeStatus }) {
  const store = useStore();
  const { meHex, settings } = store.state;
  const words = store.identity(meHex)?.words ?? [];

  return (
    <div style={{ overflowY: 'auto', padding: 'var(--s-9) var(--s-8)', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}>
        <div className="card">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile"><SettingsIcon size={14} /></span>
            <div>
              <div className="card-title">This device</div>
              <div className="card-desc">Everything on the left applies here, live.</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Glyph hex={meHex} size={44} />
              <div style={{ minWidth: 0 }}>
                <div className="setting-name">you</div>
                <ShortKey hex={meHex} />
              </div>
            </div>
            <Fingerprint words={words} />
          </div>
        </div>

        <div className="card">
          <div className="card-head" style={{ cursor: 'default' }}>
            <span className="icon-tile"><Globe size={14} /></span>
            <div>
              <div className="card-title">Connection</div>
              <div className="card-desc">Where you are on the network right now</div>
            </div>
          </div>
          <div className="card-body">
            <div className="setting-row" style={{ paddingTop: 0 }}>
              <div className="setting-body">
                <div className="setting-name">Status</div>
                <div className="setting-desc">{STATUS_COPY[status].label} · {STATUS_COPY[status].detail}</div>
              </div>
              <span className={`status-led led-${status}`} style={{ alignSelf: 'center' }} />
            </div>
            <div className="setting-row">
              <div className="setting-body">
                <div className="setting-name">Relay</div>
                <div className="setting-desc mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{settings.relay}</div>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-body">
                <div className="setting-name">Routing</div>
                <div className="setting-desc">{settings.onion ? 'Onion routing on — traffic passes through other peers.' : 'Direct via relay — fewer privacy protections.'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Boot + auth
 * ================================================================== */

function BootScreen() {
  return (
    <div data-dir="instrument" className="boot">
      <span style={{ color: 'var(--fg-secondary)' }}><KantMark /></span>
      <Spinner size={18} color="var(--fg-tertiary)" />
      <span className="t-caption">Opening local storage</span>
    </div>
  );
}

function AuthScreen({ mode, error, onDone }: { mode: 'create' | 'unlock'; error?: boolean; onDone: () => void }) {
  const [pw, setPw] = useState(error ? 'hunter2' : '');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const create = mode === 'create';

  return (
    <div data-dir="instrument" className="auth">
      <div className="auth-card anim-rise">
        <div className="auth-brand"><KantMark /><span>Kant</span></div>

        <h1 className="t-title" style={{ marginBottom: 8 }}>{create ? 'Create your identity' : 'Unlock'}</h1>
        <p className="auth-lede">
          {create
            ? 'A keypair is generated on this device and encrypted with your password. Nothing is sent anywhere, and there is no way to recover it if you forget.'
            : 'Your keypair is stored encrypted on this device.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <label className="field-label" htmlFor="pw">Password</label>
            <div className={`input-wrap lg${error ? ' is-error' : ''}`}>
              <input
                id="pw"
                className="input"
                type={show ? 'text' : 'password'}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={create ? 'At least 8 characters' : 'Your password'}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: '0 6px', height: 24, minWidth: 24 }}
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                type="button"
              >
                {show ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            {error && (
              <span className="field-error"><Alert size={12} color="var(--sig-red-9)" /> That password does not unlock this identity.</span>
            )}
          </div>

          {create && (
            <div className="field">
              <label className="field-label" htmlFor="pw2">Confirm password</label>
              <div className="input-wrap lg">
                <input id="pw2" className="input" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Type it again" />
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-lg btn-block" onClick={onDone}>
            {create ? 'Create identity' : 'Unlock'}
          </button>
        </div>

        <div className="auth-foot"><LockIcon size={12} /><span>No account, no phone number, no server copy.</span></div>
      </div>
    </div>
  );
}

function tabTitle(t: Tab) {
  return t === 'chats' ? 'Chats' : t === 'groups' ? 'Groups' : t === 'peers' ? 'Peers' : t === 'debug' ? 'Debug' : 'Settings';
}
