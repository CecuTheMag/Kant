/**
 * The chat list — people and groups in one list, newest first. This is the
 * home screen, so it only shows what matters: who you talk to, what's new,
 * and a plain-language note when you're not connected.
 */
import { useMemo, useState } from 'react';
import { useStore } from './core/store';
import type { NodeStatus } from './core/types';
import { Close, Compose, Info, QR, Refresh, Search, Spinner, Trash, VerifiedSeal, PersonAdd, Leave } from './icons';
import { displayName, listTime, useLongPress, isTouch } from './lib';
import { Avatar, Confirm, Menu } from './parts';
import type { MenuItem } from './parts';

export type ChatRef = { kind: 'dm' | 'group'; id: string };

interface Item {
  kind: 'dm' | 'group';
  id: string;
  name: string;
  seed: string;
  nickname: string;
  preview: string;
  ts: number;
  unread: number;
  online?: boolean;
  verified?: boolean;
}

export function ChatList({ active, onOpen, onSettings, onCompose, onMyCode, onAdd, onRequests, onInfo }: {
  active: ChatRef | null;
  onOpen: (ref: ChatRef) => void;
  onSettings: () => void;
  onCompose: () => void;
  onMyCode: () => void;
  onAdd: () => void;
  onRequests: () => void;
  onInfo: (ref: ChatRef) => void;
}) {
  const store = useStore();
  const { state } = store;
  const [q, setQ] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [confirm, setConfirm] = useState<ChatRef | null>(null);

  const requests = state.contacts.filter((c) => c.request && !c.blocked);
  const items: Item[] = useMemo(() => {
    const people: Item[] = state.contacts.filter((c) => !c.request && !c.blocked).map((c) => ({
      kind: 'dm', id: c.id!, name: displayName(c), seed: c.publicKeyHex, nickname: c.nickname ?? '',
      preview: c.lastMessage ?? 'No messages yet',
      ts: c.lastMessageTs ?? 0, unread: c.unread ?? 0, online: c.online, verified: c.trust === 'verified',
    }));
    const groups: Item[] = state.groups.map((g) => ({
      kind: 'group', id: g.id, name: g.name, seed: g.id, nickname: '',
      preview: g.lastMessage ?? (g.unread ? "New message" : `${g.memberKeys.length} members`), ts: g.lastMessageTs ?? 0, unread: g.unread ?? 0,
    }));
    const needle = q.trim().toLowerCase();
    return [...people, ...groups]
      .filter((it) => !needle || it.name.toLowerCase().includes(needle) || it.preview.toLowerCase().includes(needle))
      .sort((a, b) => b.ts - a.ts);
  }, [state.contacts, state.groups, q]);

  const openMenu = (it: Item, at: { x: number; y: number }) => setMenu({
    at,
    items: [
      { label: it.kind === 'dm' ? 'Contact info' : 'Group info', icon: <Info size={20} />, onSelect: () => onInfo({ kind: it.kind, id: it.id }) },
      it.kind === 'dm'
        ? { label: 'Delete', icon: <Trash size={20} />, danger: true, onSelect: () => setConfirm({ kind: 'dm', id: it.id }) }
        : { label: 'Leave group', icon: <Leave size={20} />, danger: true, onSelect: () => setConfirm({ kind: 'group', id: it.id }) },
    ],
  });

  const confirmItem = confirm ? items.find((i) => i.id === confirm.id) : null;
  const empty = items.length === 0 && !q && requests.length === 0;

  return (
    <div className="k-pane">
      <header className={`k-bar${scrolled ? ' is-lined' : ''}`}>
        <button type="button" className="k-me-btn" onClick={onSettings} aria-label="Settings">
          <Avatar name={state.settings.profileName} seed={state.meHex} size={32} />
        </button>
        <div className={`k-bar-title${scrolled ? ' is-shown' : ''}`}>Chats</div>
        <div className="k-bar-spacer" />
        <button type="button" className="k-icon-btn" onClick={onMyCode} aria-label="My code"><QR size={22} /></button>
        <button type="button" className="k-icon-btn" onClick={onCompose} aria-label="New message"><Compose size={23} /></button>
      </header>

      <div className="k-scroll" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 30)}>
        <div className="k-list-head">
          <h1 className="k-large-title">Chats</h1>
          {!empty && (
            <label className="k-search">
              <Search size={17} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search chats" />
              {q && <button type="button" className="k-search-clear" onClick={() => setQ('')} aria-label="Clear search"><Close size={12} stroke={3} /></button>}
            </label>
          )}
        </div>

        <ConnectionNote status={state.status} onRetry={() => { store.disconnect(); window.setTimeout(store.connect, 600); }} />

        {requests.length > 0 && !q && (
          <button type="button" className="k-requests-row" onClick={onRequests}>
            <PersonAdd size={20} /> Message requests <span className="k-count">{requests.length}</span>
          </button>
        )}

        {empty ? (
          <div className="k-empty" style={{ minHeight: '55vh' }}>
            <div className="k-empty-icon"><Compose size={34} /></div>
            <h2 className="k-title-2">Start a conversation</h2>
            <p>Share your code with a friend, or add theirs. Once you’re connected, everything you send is end-to-end encrypted.</p>
            <div className="k-actions">
              <button type="button" className="k-btn k-btn-primary" onClick={onMyCode}><QR size={20} /> Share my code</button>
              <button type="button" className="k-btn k-btn-secondary" onClick={onAdd}><PersonAdd size={20} /> Add a contact</button>
            </div>
          </div>
        ) : (
          <div className="k-rows" role="list">
            {items.map((it) => (
              <Row key={`${it.kind}:${it.id}`} it={it} current={active?.kind === it.kind && active.id === it.id}
                onOpen={() => onOpen({ kind: it.kind, id: it.id })} onMenu={(at) => openMenu(it, at)} />
            ))}
            {items.length === 0 && q && <p className="k-center k-muted" style={{ marginTop: 40 }}>No results for “{q}”</p>}
          </div>
        )}
      </div>

      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      {confirm && confirmItem && (
        <Confirm
          title={confirm.kind === 'dm' ? `Delete ${confirmItem.name}?` : `Leave ${confirmItem.name}?`}
          message={confirm.kind === 'dm'
            ? 'This removes them and your whole conversation from this device.'
            : 'You’ll stop receiving messages from this group.'}
          confirmLabel={confirm.kind === 'dm' ? 'Delete' : 'Leave'} danger
          onConfirm={() => (confirm.kind === 'dm' ? store.removeContact(confirm.id) : store.leaveGroup(confirm.id))}
          onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

function Row({ it, current, onOpen, onMenu }: {
  it: Item; current: boolean; onOpen: () => void; onMenu: (at: { x: number; y: number }) => void;
}) {
  const { handlers, justFired } = useLongPress(onMenu);
  return (
    <button type="button" role="listitem" className={`k-row${it.unread ? ' is-unread' : ''}`} aria-current={current || undefined}
      onClick={() => { if (!justFired()) onOpen(); }}
      onContextMenu={(e) => { e.preventDefault(); if (!justFired()) onMenu({ x: e.clientX, y: e.clientY }); }}
      {...(isTouch() ? handlers : {})}>
      <Avatar name={it.nickname} seed={it.seed} size={54} group={it.kind === 'group'} online={it.online} />
      <span className="k-row-body">
        <span className="k-row-top">
          <span className="k-row-name">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
            {it.verified && <VerifiedSeal size={14} className="k-verified" />}
          </span>
          <span className="k-row-time">{listTime(it.ts)}</span>
        </span>
        <span className="k-row-bottom">
          <span className="k-row-sub">{it.preview}</span>
          {it.unread > 0 && <span className="k-count" aria-label={`${it.unread} unread`}>{it.unread > 99 ? '99+' : it.unread}</span>}
        </span>
      </span>
    </button>
  );
}

function ConnectionNote({ status, onRetry }: { status: NodeStatus; onRetry: () => void }) {
  if (status === 'relay' || status === 'onion' || status === 'direct') return null;
  if (status === 'connecting') {
    return <div className="k-status" role="status"><Spinner size={16} /> <span><b>Connecting…</b></span></div>;
  }
  return (
    <div className={`k-status${status === 'error' ? ' is-warn' : ''}`} role="status">
      <span><b>{status === 'error' ? 'Can’t connect right now.' : 'You’re offline.'}</b> Check your internet connection.</span>
      <button type="button" className="k-btn k-btn-plain" onClick={onRetry}><Refresh size={16} /> Retry</button>
    </div>
  );
}
