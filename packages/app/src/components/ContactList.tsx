import { useState } from 'react';
import type { Contact } from '@kant/core';
import type { NodeStatus } from '../hooks/useKant';
import { AI_CONTACT_PUBKEY } from '../lib/aiClient';
import { Search } from './icons';

interface Props {
  contacts: Contact[];
  selected: Contact | null;
  onSelect: (c: Contact) => void;
  onDelete: (c: Contact) => void;
  onInitSession: (addr: string) => void;
  nodeStatus: NodeStatus;
  onlineContacts: Map<string, number>;
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#4f8ef7,#7c5cf7)',
  'linear-gradient(135deg,#f7774f,#f74f8e)',
  'linear-gradient(135deg,#34d399,#059669)',
  'linear-gradient(135deg,#fbbf24,#f59e0b)',
  'linear-gradient(135deg,#a78bfa,#7c3aed)',
  'linear-gradient(135deg,#f472b6,#ec4899)',
  'linear-gradient(135deg,#38bdf8,#0284c7)',
];

function avatarGradient(hex: string): string {
  return AVATAR_GRADIENTS[parseInt(hex.slice(0, 2), 16) % AVATAR_GRADIENTS.length];
}

export function ContactList({ contacts, selected, onSelect, onDelete, onInitSession, nodeStatus, onlineContacts }: Props) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? contacts.filter(c =>
        (c.nickname || c.publicKeyHex).toLowerCase().includes(q) ||
        c.publicKeyHex.toLowerCase().includes(q))
    : contacts;

  if (contacts.length === 0) {
    return (
      <div style={s.empty}>
        <div style={s.emptyIconWrap}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <p style={s.emptyTitle}>No contacts yet</p>
        <p style={s.emptyHint}>Add a contact using their public key</p>
      </div>
    );
  }

  return (
    <div style={s.list}>
      {/* Search — filters by nickname or key */}
      <div style={s.searchWrap}>
        <Search size={13} color="var(--text3)" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search contacts…"
          style={s.searchInput}
          spellCheck={false}
          aria-label="Search contacts"
        />
        {query && (
          <button onClick={() => setQuery('')} style={s.searchClear} aria-label="Clear search">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <div style={s.noResults}>
          <p style={s.noResultsText}>No matches for “{query.trim()}”</p>
        </div>
      )}

      {filtered.map(c => {
        const isSelected = selected?.publicKeyHex === c.publicKeyHex;
        const isAi       = c.publicKeyHex === AI_CONTACT_PUBKEY;
        const isOnline   = isAi || onlineContacts.has(c.publicKeyHex);
        const hasAddr    = !!(c.lastCircuitAddr);
        const isHovered  = hoveredKey === c.publicKeyHex;

        return (
          <div
            key={c.publicKeyHex}
            onClick={() => onSelect(c)}
            onMouseEnter={() => setHoveredKey(c.publicKeyHex)}
            onMouseLeave={() => setHoveredKey(null)}
            style={{
              ...s.row,
              background: isSelected
                ? 'var(--bg4)'
                : isHovered
                ? 'var(--bg3)'
                : 'transparent',
            }}
          >
            {/* Active indicator bar */}
            <div style={{
              ...s.activeBar,
              opacity: isSelected ? 1 : 0,
            }} />

            {/* Avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                ...s.avatar,
                background: isAi ? 'linear-gradient(135deg,#4f8ef7,#7c5cf7)' : avatarGradient(c.publicKeyHex),
                boxShadow: isSelected ? '0 2px 12px rgba(79,142,247,0.3)' : 'none',
              }}>
                {isAi ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    <circle cx="12" cy="16" r="1" fill="white"/>
                  </svg>
                ) : (
                  <span style={s.avatarText}>
                    {(c.nickname || c.publicKeyHex).slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              {isOnline && (
                <span style={s.onlineDot} className="pulse-dot" />
              )}
            </div>

            {/* Info */}
            <div style={s.info}>
              <div style={s.name}>
                {c.nickname || c.publicKeyHex.slice(0, 14) + '…'}
              </div>
              <div style={s.status}>
                {isAi
                  ? <span style={{ color: 'var(--accent)' }}>AI · always available</span>
                  : isOnline
                  ? <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={s.statusDotGreen} />online</span>
                  : hasAddr
                  ? <span style={{ color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={s.statusDotMuted} />offline</span>
                  : <span style={{ color: 'var(--yellow)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={s.statusDotYellow} />no address</span>
                }
              </div>
            </div>

            {/* Actions — only visible on hover/selected */}
            <div style={{
              ...s.actions,
              opacity: isHovered || isSelected ? 1 : 0,
              transition: 'opacity 0.15s',
            }} onClick={e => e.stopPropagation()}>
              {!isAi && (nodeStatus === 'connected' || nodeStatus === 'chatting') && !isOnline && hasAddr && (
                <button
                  onClick={() => onInitSession(c.lastCircuitAddr!)}
                  style={s.iconBtn}
                  title="Retry session"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
              )}
              {!isAi && (
                <button
                  onClick={() => onDelete(c)}
                  style={{ ...s.iconBtn, color: 'var(--red)' }}
                  title="Remove contact"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    padding: '4px 0',
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '0 12px 8px',
    padding: '0 10px',
    height: 34,
    borderRadius: 10,
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text1)',
    fontSize: 12.5,
    boxShadow: 'none !important',
  },
  searchClear: {
    width: 20,
    height: 20,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text3)',
    minHeight: 'unset',
    flexShrink: 0,
  },
  noResults: {
    padding: '24px 16px',
    textAlign: 'center',
  },
  noResultsText: {
    fontSize: 12,
    color: 'var(--text3)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px 10px 20px',
    cursor: 'pointer',
    transition: 'background 0.12s',
    position: 'relative',
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: '20%',
    bottom: '20%',
    width: 3,
    borderRadius: '0 3px 3px 0',
    background: 'var(--accent)',
    transition: 'opacity 0.15s',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'box-shadow 0.2s',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.5px',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: 'var(--green)',
    border: '2px solid var(--bg1)',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  status: {
    fontSize: 11,
    marginTop: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  statusDotGreen: {
    width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', flexShrink: 0,
  },
  statusDotMuted: {
    width: 7, height: 7, borderRadius: '50%', background: 'var(--text3)', opacity: 0.5, flexShrink: 0,
  },
  statusDotYellow: {
    width: 7, height: 7, borderRadius: '50%', background: 'var(--yellow)', flexShrink: 0,
  },
  actions: {
    display: 'flex',
    gap: 2,
    alignItems: 'center',
    flexShrink: 0,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text3)',
    background: 'var(--bg4)',
    minHeight: 'unset',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '48px 24px',
    color: 'var(--text3)',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    background: 'var(--bg3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text2)',
  },
  emptyHint: {
    fontSize: 12,
    color: 'var(--text3)',
    textAlign: 'center',
    lineHeight: 1.5,
  },
};
