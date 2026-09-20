import { useRef, useEffect, useState } from 'react';
import type { Group } from '@kant/core';
import type { PlainGroupMessage } from '../hooks/useGroups';
import type { NodeStatus } from '../hooks/useKant';
import { Clock, Check, DoubleCheck } from './icons';
import { sameDay, dayLabel, formatTime } from '../lib/format';

interface Props {
  group: Group | null;
  messages: PlainGroupMessage[];
  myPubKeyHex: string;
  nodeStatus: NodeStatus;
  onSend: (text: string) => void;
  onRemoveMember: (group: Group, memberPubKeyHex: string) => void;
  expiryTtl: number;
  onExpiryChange: (ttl: number) => void;
  onlineMembers: Map<string, number>;
  onBack: () => void;
}

const EXPIRY_OPTIONS = [
  { value: 0,         label: 'No expiry' },
  { value: 30000,     label: '30 seconds' },
  { value: 300000,    label: '5 minutes' },
  { value: 3600000,   label: '1 hour' },
  { value: 86400000,  label: '24 hours' },
  { value: 604800000, label: '7 days' },
];

const MEMBER_GRADIENTS = [
  'linear-gradient(135deg,#4f8ef7,#7c5cf7)',
  'linear-gradient(135deg,#f7774f,#f74f8e)',
  'linear-gradient(135deg,#34d399,#059669)',
  'linear-gradient(135deg,#fbbf24,#f59e0b)',
  'linear-gradient(135deg,#a78bfa,#7c3aed)',
  'linear-gradient(135deg,#f472b6,#ec4899)',
  'linear-gradient(135deg,#38bdf8,#0284c7)',
];
function memberGradient(hex: string) {
  return MEMBER_GRADIENTS[parseInt(hex.slice(0, 2), 16) % MEMBER_GRADIENTS.length];
}

export function GroupChatArea({ group, messages, myPubKeyHex, nodeStatus, onSend, onRemoveMember, expiryTtl, onExpiryChange, onlineMembers, onBack }: Props) {
  const [input, setInput]             = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [showExpiry, setShowExpiry]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function handleSend() {
    const text = input.trim();
    if (!text || !group || nodeStatus === 'idle' || nodeStatus === 'connecting') return;
    setInput('');
    onSend(text);
  }

  if (!group) {
    return (
      <div style={s.empty}>
        <div style={s.emptyOrb} />
        <div style={s.emptyIconWrap}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <p style={s.emptyTitle}>Select a group</p>
        <p style={s.emptyHint}>All group messages are end-to-end encrypted</p>
      </div>
    );
  }

  const canSend = nodeStatus === 'connected' || nodeStatus === 'chatting';
  const onlineCount = group.members.filter(m =>
    m.publicKeyHex === myPubKeyHex || onlineMembers.has(m.publicKeyHex)
  ).length;
  const currentExpiry = EXPIRY_OPTIONS.find(o => o.value === expiryTtl) ?? EXPIRY_OPTIONS[0];

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <button onClick={onBack} style={s.backBtn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div style={s.headerAvatar}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {group.name.slice(0, 2).toUpperCase()}
          </span>
        </div>

        <div style={s.headerInfo}>
          <div style={s.headerName}>{group.name}</div>
          <div style={s.headerSub}>
            <span style={{ color: 'var(--green)', fontSize: 9 }}>●</span>
            <span>{group.members.length} members</span>
            <span style={{ color: 'var(--text3)' }}>·</span>
            <span style={{ color: onlineCount > 1 ? 'var(--green)' : 'var(--text3)' }}>
              {onlineCount} online
            </span>
          </div>
        </div>

        <div style={s.headerActions}>
          {/* Expiry picker */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowExpiry(v => !v)}
              style={{ ...s.headerBtn, ...(expiryTtl > 0 ? s.headerBtnActive : {}) }}
              title="Message expiry"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
            {showExpiry && (
              <div style={s.expiryDropdown} className="fade-up">
                {EXPIRY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { onExpiryChange(opt.value); setShowExpiry(false); }}
                    style={{
                      ...s.expiryOption,
                      background: expiryTtl === opt.value ? 'var(--accent-dim)' : 'transparent',
                      color: expiryTtl === opt.value ? 'var(--accent)' : 'var(--text2)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Members toggle */}
          <button
            onClick={() => setShowMembers(v => !v)}
            style={{ ...s.headerBtn, ...(showMembers ? s.headerBtnActive : {}) }}
            title="Members"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>
        </div>
      </div>

      <div style={s.body}>
        {/* Members panel */}
        {showMembers && (
          <div style={s.membersPanel} className="members-panel-mobile slide-right">
            <div style={s.membersPanelHeader}>
              <span style={s.membersPanelTitle}>Members</span>
              <button onClick={() => setShowMembers(false)} style={s.closePanelBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div style={s.membersList}>
              {group.members.map(m => {
                const isMe     = m.publicKeyHex === myPubKeyHex;
                const isOwner  = m.publicKeyHex === group.createdBy;
                const isOnline = isMe || onlineMembers.has(m.publicKeyHex);
                return (
                  <div key={m.publicKeyHex} style={s.memberItem}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ ...s.memberAvatar, background: memberGradient(m.publicKeyHex) }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>
                          {(m.nickname || m.publicKeyHex).slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      {isOnline && <span style={s.memberOnlineDot} />}
                    </div>
                    <div style={s.memberInfo}>
                      <div style={s.memberName}>
                        {m.nickname || m.publicKeyHex.slice(0, 12) + '…'}
                      </div>
                      <div style={s.memberMeta}>
                        {isMe && <span style={s.memberTag}>you</span>}
                        {isOwner && <span style={s.memberTag}>owner</span>}
                        {!isMe && !isOwner && (
                          <span style={{ color: isOnline ? 'var(--green)' : 'var(--text3)', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? 'var(--green)' : 'var(--text3)', opacity: isOnline ? 1 : 0.5 }} />
                            {isOnline ? 'online' : 'offline'}
                          </span>
                        )}
                      </div>
                    </div>
                    {!isMe && group.createdBy === myPubKeyHex && (
                      <button
                        onClick={() => onRemoveMember(group, m.publicKeyHex)}
                        style={s.removeMemberBtn}
                        title="Remove member"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Messages */}
        <div style={s.messages}>
          {messages.length === 0 && (
            <div style={s.noMessages}>
              <div style={s.noMsgIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p style={{ color: 'var(--text2)', fontSize: 14, fontWeight: 500 }}>No messages yet</p>
              <p style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>
                {canSend ? 'Send the first message' : 'Connect to the network first'}
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || !sameDay(prev.ts, m.ts);
            return (
              <GroupBubble
                key={m.id}
                msg={m}
                prevMsg={prev}
                nextMsg={messages[i + 1]}
                members={group.members}
                dayDivider={showDay ? dayLabel(m.ts) : null}
              />
            );
          })}
          <div ref={bottomRef} style={{ height: 1 }} />
        </div>
      </div>

      {/* Input row */}
      <div style={s.inputRow} className="input-row-mobile">
        {expiryTtl > 0 && (
          <div style={s.expiryPill}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {currentExpiry.label}
          </div>
        )}
        <div style={s.inputWrap} className="composer-wrap">
          <textarea
            style={s.input}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={canSend ? `Message ${group.name}…` : 'Connect to network first'}
            disabled={!canSend}
            rows={1}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!canSend || !input.trim()}
          style={{
            ...s.sendBtn,
            background: canSend && input.trim()
              ? 'linear-gradient(135deg,#4f8ef7,#6b7cf7)'
              : 'var(--bg4)',
            boxShadow: canSend && input.trim()
              ? '0 4px 16px rgba(79,142,247,0.4)'
              : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function GroupBubble({ msg, prevMsg, nextMsg, members, dayDivider }: {
  msg: PlainGroupMessage;
  prevMsg?: PlainGroupMessage;
  nextMsg?: PlainGroupMessage;
  members: { publicKeyHex: string; nickname?: string }[];
  dayDivider?: string | null;
}) {
  const isMe       = msg.fromMe;
  const showTime   = !prevMsg || msg.ts - prevMsg.ts > 5 * 60 * 1000;
  const showName   = !isMe && (!prevMsg || prevMsg.fromPubKeyHex !== msg.fromPubKeyHex || showTime);
  const isLastInGroup = !nextMsg || nextMsg.fromPubKeyHex !== msg.fromPubKeyHex || nextMsg.ts - msg.ts > 5 * 60 * 1000;
  const member     = members.find(m => m.publicKeyHex === msg.fromPubKeyHex);
  const senderName = member?.nickname || msg.fromPubKeyHex.slice(0, 12) + '…';
  const isExpiring = msg.expiresAt > 0 && msg.expiresAt - Date.now() < 60_000;
  const readCount  = msg.readBy?.length ?? 0;

  const bubbleRadius: React.CSSProperties = isMe
    ? { borderRadius: isLastInGroup ? '18px 18px 4px 18px' : '18px 18px 6px 18px' }
    : { borderRadius: isLastInGroup ? '18px 18px 18px 4px' : '18px 18px 18px 6px' };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMe ? 'flex-end' : 'flex-start',
        marginBottom: isLastInGroup ? 8 : 2,
      }}
      className="fade-up"
    >
      {dayDivider && (
        <div className="date-divider" style={{ width: '100%' }}>
          <span>{dayDivider}</span>
        </div>
      )}
      {showTime && (
        <div style={s.timeLabel}>
          {formatTime(msg.ts)}
        </div>
      )}
      {showName && (
        <div style={s.senderName}>{senderName}</div>
      )}
      <div style={{
        ...s.bubble,
        ...(isMe ? s.bubbleMe : s.bubbleThem),
        ...bubbleRadius,
        ...(isExpiring ? s.bubbleExpiring : {}),
      }}>
        <span style={s.bubbleText}>{msg.text}</span>
        <div style={s.bubbleMeta}>
          {msg.expiresAt > 0 && (
            <Clock size={10} color={isExpiring ? 'var(--yellow)' : 'var(--text3)'} />
          )}
          <span style={s.bubbleTime} className="tabular">
            {formatTime(msg.ts)}
          </span>
          {isMe && (
            <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
              {readCount > 0
                ? <DoubleCheck size={13} color="var(--accent)" />
                : <Check size={12} color="var(--text3)" />}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg0)', minWidth: 0 },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 10, position: 'relative', overflow: 'hidden',
  },
  emptyOrb: {
    position: 'absolute', width: 400, height: 400, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(79,142,247,0.06) 0%, transparent 70%)', pointerEvents: 'none',
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 22, background: 'var(--bg3)',
    border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: 600, color: 'var(--text1)' },
  emptyHint: { fontSize: 13, color: 'var(--text3)', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 16px',
    background: 'rgba(17,24,32,0.85)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    borderBottom: '1px solid var(--border)', flexShrink: 0,
    position: 'sticky', top: 0, zIndex: 5,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text2)', background: 'var(--bg3)', flexShrink: 0, minHeight: 'unset',
  },
  headerAvatar: {
    width: 40, height: 40, borderRadius: 13,
    background: 'linear-gradient(135deg,#4f8ef7,#7c5cf7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, boxShadow: '0 2px 12px rgba(79,142,247,0.3)',
  },
  headerInfo: { flex: 1, minWidth: 0 },
  headerName: { fontSize: 15, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  headerSub: { fontSize: 11, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 },
  headerActions: { display: 'flex', gap: 6, flexShrink: 0 },
  headerBtn: {
    width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text2)', background: 'var(--bg3)', minHeight: 'unset',
  },
  headerBtnActive: { background: 'var(--accent-dim)', color: 'var(--accent)' },
  expiryDropdown: {
    position: 'absolute', top: '100%', right: 0, marginTop: 6,
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 12, overflow: 'hidden', zIndex: 50,
    boxShadow: 'var(--shadow-md)', minWidth: 140,
  },
  expiryOption: {
    display: 'block', width: '100%', padding: '9px 14px',
    fontSize: 13, textAlign: 'left', cursor: 'pointer', minHeight: 'unset',
    transition: 'background 0.1s',
  },
  body: { flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' },
  membersPanel: {
    width: 220, flexShrink: 0, background: 'var(--bg1)',
    borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
  },
  membersPanelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 14px 10px', borderBottom: '1px solid var(--border)',
  },
  membersPanelTitle: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.7px' },
  closePanelBtn: {
    width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text3)', background: 'var(--bg3)', minHeight: 'unset',
  },
  membersList: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  memberItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' },
  memberAvatar: {
    width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  memberOnlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', border: '2px solid var(--bg1)',
  },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 12, fontWeight: 500, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  memberMeta: { display: 'flex', gap: 4, marginTop: 2 },
  memberTag: { fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 4, padding: '1px 5px' },
  removeMemberBtn: {
    width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--red)', background: 'rgba(248,113,113,0.1)', flexShrink: 0, minHeight: 'unset',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '20px 20px 8px',
    display: 'flex', flexDirection: 'column',
  },
  noMessages: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 8, padding: '60px 0',
  },
  noMsgIcon: {
    width: 56, height: 56, borderRadius: 18, background: 'var(--bg3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  timeLabel: {
    textAlign: 'center', fontSize: 11, color: 'var(--text3)',
    margin: '16px auto 8px', background: 'var(--bg3)', borderRadius: 99,
    padding: '3px 10px', alignSelf: 'center',
  },
  senderName: { fontSize: 11, color: 'var(--accent)', marginBottom: 3, paddingLeft: 4, fontWeight: 500 },
  bubble: {
    maxWidth: '70%', padding: '10px 14px',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  bubbleMe: { background: 'var(--bubble-out)', border: '1px solid rgba(79,142,247,0.15)' },
  bubbleThem: { background: 'var(--bubble-in)', border: '1px solid var(--border)' },
  bubbleExpiring: { border: '1px solid rgba(251,191,36,0.4)', opacity: 0.75 },
  bubbleText: { fontSize: 14, color: 'var(--text1)', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' },
  bubbleMeta: { display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 2 },
  bubbleTime: { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
  inputRow: {
    display: 'flex', gap: 10, padding: '12px 16px',
    background: 'var(--bg1)', borderTop: '1px solid var(--border)', alignItems: 'flex-end',
    paddingBottom: 'max(12px, calc(12px + env(safe-area-inset-bottom)))',
    flexWrap: 'wrap',
  },
  expiryPill: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11, color: 'var(--yellow)', background: 'rgba(251,191,36,0.1)',
    border: '1px solid rgba(251,191,36,0.2)', borderRadius: 99, padding: '4px 10px',
    width: '100%', marginBottom: 4,
  },
  inputWrap: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 14, padding: '2px 4px',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  input: {
    width: '100%', background: 'transparent', border: 'none',
    padding: '9px 12px', color: 'var(--text1)', fontSize: 14,
    resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', display: 'block',
  } as React.CSSProperties,
  sendBtn: {
    width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, minHeight: 'unset', transition: 'background 0.2s, box-shadow 0.2s, transform 0.1s',
  },
};
