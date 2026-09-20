import { useRef, useEffect, useState } from 'react';
import type { Contact, MessageStatus, MessageAttachment } from '@kant/core';
import type { PlainMessage, NodeStatus } from '../hooks/useKant';
import { AI_CONTACT_PUBKEY } from '../lib/aiClient';
import { Spinner, Check, DoubleCheck, Clock, Image as ImageIcon } from './icons';
import { sameDay, dayLabel, formatTime } from '../lib/format';

interface Props {
  contact: Contact | null;
  messages: PlainMessage[];
  nodeStatus: NodeStatus;
  onSend: (text: string) => void;
  onSendFile: (file: File) => void;
  loadAttachmentUrl: (att: MessageAttachment) => Promise<string | null>;
  downloadAttachment: (att: MessageAttachment) => Promise<boolean>;
  onInitSession: (addr: string) => void;
  onBack: () => void;
}

export function ChatArea({ contact, messages, nodeStatus, onSend, onSendFile, loadAttachmentUrl, downloadAttachment, onBack }: Props) {
  const [input, setInput]     = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const messagesRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const isAi    = contact?.publicKeyHex === AI_CONTACT_PUBKEY;
  const canChat = isAi || nodeStatus === 'chatting';

  function handleSend() {
    const text = input.trim();
    if (!text || !canChat) return;
    setInput('');
    onSend(text);
  }

  function handleFiles(files: FileList | null) {
    if (!files || !canChat || isAi) return;
    for (const f of Array.from(files)) onSendFile(f);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!contact) {
    return (
      <div style={s.empty}>
        <div style={s.emptyOrb} />
        <div style={s.emptyIconWrap}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <line x1="9" y1="10" x2="15" y2="10"/>
            <line x1="12" y1="7" x2="12" y2="13"/>
          </svg>
        </div>
        <p style={s.emptyTitle}>Select a conversation</p>
        <p style={s.emptyHint}>All messages are end-to-end encrypted with Double Ratchet</p>
        <div style={s.emptyBadge}>
          <span style={{ color: 'var(--green)', fontSize: 10 }}>●</span>
          Zero-knowledge · No server storage
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ ...s.root, ...(dragOver ? s.rootDrag : {}) }}
      onDragOver={e => { if (canChat && !isAi) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div style={s.dragOverlay}>
          <div style={s.dragContent}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p style={{ color: 'var(--text1)', fontWeight: 600, marginTop: 12 }}>Drop to send file</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={s.header} className="chat-header">
        <button onClick={onBack} style={s.backBtn} title="Back" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div style={s.headerAvatar}>
          {isAi ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              <circle cx="12" cy="16" r="1" fill="white"/>
            </svg>
          ) : (
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
              {(contact.nickname || contact.publicKeyHex).slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div style={s.headerInfo}>
          <div style={s.headerName}>
            {contact.nickname || contact.publicKeyHex.slice(0, 16) + '…'}
          </div>
          <div style={s.headerSub}>
            {isAi ? (
              <span style={{ color: 'var(--text3)' }}>Direct model call</span>
            ) : canChat ? (
              <>
                <span style={{ color: 'var(--green)', fontSize: 9 }}>●</span>
                <span style={{ color: 'var(--green)' }}>Encrypted · Double Ratchet</span>
              </>
            ) : nodeStatus === 'connected' ? (
              <>
                <span style={{ color: 'var(--yellow)', fontSize: 9 }}>●</span>
                <span style={{ color: 'var(--yellow)' }}>Waiting for contact…</span>
              </>
            ) : (
              <span style={{ color: 'var(--text3)' }}>Connect to network first</span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={s.messages} ref={messagesRef}>
        {messages.length === 0 && (
          <div style={s.noMessages}>
            <div style={s.noMsgIcon}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)' }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p style={{ color: 'var(--text2)', fontSize: 14, fontWeight: 500 }}>No messages yet</p>
            <p style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>
              {canChat ? 'Send the first message' : 'Start a session to begin chatting'}
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || !sameDay(prev.ts, m.ts);
          return (
            <MessageBubble
              key={m.id}
              msg={m}
              prevMsg={prev}
              nextMsg={messages[i + 1]}
              loadAttachmentUrl={loadAttachmentUrl}
              downloadAttachment={downloadAttachment}
              dayDivider={showDay ? dayLabel(m.ts) : null}
            />
          );
        })}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* Input row */}
      <div style={s.inputRow} className="input-row-mobile">
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!canChat || isAi}
          style={s.attachBtn}
          title={isAi ? 'Attachments not supported for AI' : 'Attach file'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <div style={s.inputWrap} className="composer-wrap">
          <textarea
            style={s.input}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              // Auto-resize
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            placeholder={canChat ? 'Message…' : 'Start a session first'}
            disabled={!canChat}
            rows={1}
          />
        </div>

        <button
          onClick={handleSend}
          disabled={!canChat || !input.trim()}
          style={{
            ...s.sendBtn,
            background: canChat && input.trim()
              ? 'linear-gradient(135deg,#4f8ef7,#6b7cf7)'
              : 'var(--bg4)',
            boxShadow: canChat && input.trim()
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

function MessageBubble({
  msg, prevMsg, nextMsg, loadAttachmentUrl, downloadAttachment, dayDivider,
}: {
  msg: PlainMessage;
  prevMsg?: PlainMessage;
  nextMsg?: PlainMessage;
  loadAttachmentUrl: (att: MessageAttachment) => Promise<string | null>;
  downloadAttachment: (att: MessageAttachment) => Promise<boolean>;
  dayDivider?: string | null;
}) {
  const isMe = msg.from === 'me';
  const showTimestamp = !prevMsg || msg.ts - prevMsg.ts > 5 * 60 * 1000;
  const isLastInGroup = !nextMsg || nextMsg.from !== msg.from || nextMsg.ts - msg.ts > 5 * 60 * 1000;

  const bubbleRadius: React.CSSProperties = isMe
    ? { borderRadius: '18px 18px 4px 18px' }
    : { borderRadius: '18px 18px 18px 4px' };

  if (!isLastInGroup) {
    Object.assign(bubbleRadius, isMe
      ? { borderRadius: '18px 18px 6px 18px' }
      : { borderRadius: '18px 18px 18px 6px' });
  }

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
      {showTimestamp && (
        <div style={s.timeLabel}>
          {formatTime(msg.ts)}
        </div>
      )}
      <div style={{
        ...s.bubble,
        ...(isMe ? s.bubbleMe : s.bubbleThem),
        ...bubbleRadius,
      }}>
        {msg.attachment && (
          <AttachmentView att={msg.attachment} loadAttachmentUrl={loadAttachmentUrl} downloadAttachment={downloadAttachment} />
        )}
        {msg.text && (
          <span style={s.bubbleText}>{msg.text}</span>
        )}
        <div style={s.bubbleMeta}>
          <span style={s.bubbleTime} className="tabular">
            {formatTime(msg.ts)}
          </span>
          {isMe && (
            <span style={{
              ...s.statusIcon,
              color: msg.status === 'read' ? 'var(--accent)'
                : msg.status === 'delivered' ? 'var(--text2)'
                : 'var(--text3)',
            }}>
              {statusIcon(msg.status)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentView({ att, loadAttachmentUrl, downloadAttachment }: {
  att: MessageAttachment;
  loadAttachmentUrl: (att: MessageAttachment) => Promise<string | null>;
  downloadAttachment: (att: MessageAttachment) => Promise<boolean>;
}) {
  const [url, setUrl]       = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isImage = att.display === 'inline' && att.mimeType.startsWith('image/');
  const pending = att.fileId === 'pending';

  useEffect(() => {
    if (!isImage || pending) return;
    let active = true;
    let created: string | null = null;
    setLoading(true);
    loadAttachmentUrl(att).then(u => {
      if (!active) return;
      created = u;
      setUrl(u);
      setLoading(false);
    });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [att.fileId]);

  async function download() {
    if (pending) return;
    await downloadAttachment(att);
  }

  const sizeStr = att.fileSize > 1024 * 1024
    ? `${(att.fileSize / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(att.fileSize / 1024))} KB`;

  if (isImage) {
    if (loading || !url) {
      return (
        <div style={s.imgPlaceholder}>
          {loading
            ? <Spinner size={20} color="var(--accent)" />
            : <ImageIcon size={22} color="var(--text3)" />}
          <span style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.fileName}</span>
        </div>
      );
    }
    return (
      <img
        src={url}
        alt={att.fileName}
        style={s.attachImg}
        onClick={download}
        title="Click to download"
      />
    );
  }

  return (
    <div style={s.fileChip} onClick={download}>
      <div style={s.fileIcon}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div style={s.fileInfo}>
        <span style={s.fileName}>{att.fileName}</span>
        <span style={s.fileSize}>{sizeStr}{pending ? ' · uploading…' : ' · tap to download'}</span>
      </div>
      {!pending && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)', flexShrink: 0 }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      )}
    </div>
  );
}

function statusIcon(status: MessageStatus): React.ReactNode {
  switch (status) {
    case 'sending':
      return <Clock size={12} color="var(--text3)" />;
    case 'sent':
      return <Check size={12} color="var(--text3)" />;
    case 'delivered':
      return <DoubleCheck size={13} color="var(--text2)" />;
    case 'read':
      return <DoubleCheck size={13} color="var(--accent)" />;
    default:
      return null;
  }
}

const s: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg0)',
    minWidth: 0,
    position: 'relative',
  },
  rootDrag: {
    outline: '2px dashed var(--accent)',
    outlineOffset: -4,
  },
  dragOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(13,17,23,0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    borderRadius: 0,
  },
  dragContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 40,
    borderRadius: 20,
    border: '2px dashed var(--accent)',
    background: 'var(--accent-dim)',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  emptyOrb: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(79,142,247,0.06) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  emptyHint: {
    fontSize: 13,
    color: 'var(--text3)',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 1.5,
  },
  emptyBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: 'var(--text3)',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 99,
    padding: '5px 12px',
    marginTop: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    background: 'rgba(17,24,32,0.85)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 5,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text2)',
    background: 'var(--bg3)',
    flexShrink: 0,
    minHeight: 'unset',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    background: 'linear-gradient(135deg,#4f8ef7,#7c5cf7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 2px 12px rgba(79,142,247,0.3)',
  },
  headerInfo: { flex: 1, minWidth: 0 },
  headerName: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerSub: {
    fontSize: 11,
    color: 'var(--text2)',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 20px 8px',
    display: 'flex',
    flexDirection: 'column',
  },
  noMessages: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '60px 0',
  },
  noMsgIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    background: 'var(--bg3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  timeLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: 'var(--text3)',
    margin: '16px auto 8px',
    background: 'var(--bg3)',
    borderRadius: 99,
    padding: '3px 10px',
    alignSelf: 'center',
  },
  bubble: {
    maxWidth: '70%',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  bubbleMe: {
    background: 'var(--bubble-out)',
    border: '1px solid rgba(79,142,247,0.15)',
  },
  bubbleThem: {
    background: 'var(--bubble-in)',
    border: '1px solid var(--border)',
  },
  bubbleText: {
    fontSize: 14,
    color: 'var(--text1)',
    lineHeight: 1.5,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  bubbleMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  bubbleTime: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
  },
  statusIcon: {
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: 0,
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    padding: '12px 16px',
    background: 'rgba(17,24,32,0.85)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    borderTop: '1px solid var(--border)',
    alignItems: 'flex-end',
    paddingBottom: 'max(12px, calc(12px + env(safe-area-inset-bottom)))',
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text2)',
    background: 'var(--bg3)',
    flexShrink: 0,
    minHeight: 'unset',
    transition: 'background 0.15s, color 0.15s',
  },
  inputWrap: {
    flex: 1,
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: '2px 4px',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  input: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '9px 12px',
    color: 'var(--text1)',
    fontSize: 14,
    resize: 'none',
    lineHeight: 1.5,
    maxHeight: 120,
    overflowY: 'auto',
    display: 'block',
    boxShadow: 'none !important',
  } as React.CSSProperties,
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    minHeight: 'unset',
    transition: 'background 0.2s, box-shadow 0.2s, transform 0.1s',
  },
  imgPlaceholder: {
    width: 200,
    height: 120,
    borderRadius: 10,
    background: 'var(--bg4)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachImg: {
    maxWidth: 260,
    maxHeight: 260,
    borderRadius: 10,
    cursor: 'pointer',
    display: 'block',
    objectFit: 'cover',
    transition: 'opacity 0.15s',
  },
  fileChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    padding: '10px 12px',
    maxWidth: 260,
    transition: 'background 0.15s',
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: 'var(--accent-dim)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  fileName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileSize: {
    fontSize: 11,
    color: 'var(--text3)',
  },
};
