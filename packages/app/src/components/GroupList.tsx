import { useState } from 'react';
import type { Group } from '@kant/core';
import type { PlainGroupMessage } from '../hooks/useGroups';

interface Props {
  groups: Group[];
  selected: Group | null;
  myPubKeyHex: string;
  onSelect: (g: Group) => void;
  onLeave: (g: Group) => void;
  onCreate: () => void;
  lastMessages?: Map<string, PlainGroupMessage>;
  unreadCounts?: Map<string, number>;
  keyDistStatus?: Map<string, string>;
}

const GROUP_GRADIENTS = [
  'linear-gradient(135deg,#4f8ef7,#7c5cf7)',
  'linear-gradient(135deg,#f7774f,#f74f8e)',
  'linear-gradient(135deg,#34d399,#059669)',
  'linear-gradient(135deg,#fbbf24,#f59e0b)',
  'linear-gradient(135deg,#a78bfa,#7c3aed)',
  'linear-gradient(135deg,#f472b6,#ec4899)',
  'linear-gradient(135deg,#38bdf8,#0284c7)',
];

function groupGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return GROUP_GRADIENTS[hash % GROUP_GRADIENTS.length];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function GroupList({ groups, selected, myPubKeyHex, onSelect, onLeave, onCreate, lastMessages, unreadCounts, keyDistStatus }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.title}>Groups</span>
        <button onClick={onCreate} style={s.newBtn} aria-label="Create group" title="Create group">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      {groups.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIconWrap}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <p style={s.emptyTitle}>No groups yet</p>
          <p style={s.emptyHint}>Create a group to start a conversation</p>
        </div>
      ) : (
        groups.map(g => {
          const isSelected = selected?.id === g.id;
          const isOwner    = g.createdBy === myPubKeyHex;
          const last       = lastMessages?.get(g.id);
          const unread     = unreadCounts?.get(g.id) ?? 0;
          const isHovered  = hoveredId === g.id;

          return (
            <div
              key={g.id}
              onClick={() => onSelect(g)}
              onMouseEnter={() => setHoveredId(g.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                ...s.row,
                background: isSelected ? 'var(--bg4)' : isHovered ? 'var(--bg3)' : 'transparent',
              }}
            >
              <div style={{ ...s.activeBar, opacity: isSelected ? 1 : 0 }} />

              <div style={{ ...s.avatar, background: groupGradient(g.id) }}>
                <span style={s.avatarText}>{g.name.slice(0, 2).toUpperCase()}</span>
              </div>

              <div style={s.info}>
                <div style={s.nameRow}>
                  <span style={s.name}>{g.name}</span>
                  {last && <span style={s.time}>{formatTime(last.ts)}</span>}
                </div>
                <div style={s.previewRow}>
                  <span style={s.preview}>
                    {last
                      ? (last.fromMe ? 'You: ' : '') + last.text
                      : `${g.members.length} member${g.members.length !== 1 ? 's' : ''}${isOwner ? ' · owner' : ''}`
                    }
                  </span>
                  {(() => {
                    const st = keyDistStatus?.get(g.id);
                    if (!st || st === 'distributed') return null;
                    const label = st === 'distributing' ? 'Distributing key…' : st === 'failed' ? 'Key failed' : 'Creating…';
                    return <span className="group-key-status" style={s.distStatus}>{label}</span>;
                  })()}
                  {keyDistStatus?.get(g.id) === 'distributed' && (
                    <span className="group-key-status" style={s.distStatus}>Key distributed</span>
                  )}
                  {unread > 0 && (
                    <span style={s.badge} className="badgePop">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={e => { e.stopPropagation(); onLeave(g); }}
                style={{
                  ...s.leaveBtn,
                  opacity: isHovered || isSelected ? 1 : 0,
                  transition: 'opacity 0.15s',
                }}
                title={isOwner ? 'Delete group' : 'Leave group'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px 8px 20px',
  },
  title: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
  },
  newBtn: {
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
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '40px 24px',
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
  emptyTitle: { fontSize: 14, fontWeight: 500, color: 'var(--text2)' },
  emptyHint: { fontSize: 12, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 },
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
  },
  avatarText: { fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '0.5px' },
  info: { flex: 1, minWidth: 0 },
  nameRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 4,
  },
  name: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  time: { fontSize: 11, color: 'var(--text3)', flexShrink: 0 },
  previewRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    marginTop: 2,
  },
  preview: {
    fontSize: 12,
    color: 'var(--text3)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  badge: {
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 99,
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 7px',
    flexShrink: 0,
    animation: 'badgePop 0.3s cubic-bezier(0.16,1,0.3,1) both',
  },
  distStatus: {
    fontSize: 10,
    color: 'var(--text3)',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },
  leaveBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text3)',
    background: 'var(--bg4)',
    flexShrink: 0,
    minHeight: 'unset',
  },
};
