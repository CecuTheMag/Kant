/**
 * A single conversation — one-to-one or group. Header, message thread,
 * request / key-change prompts and the composer (text, replies, edits,
 * attachments, voice notes, new tables and documents).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from './core/store';
import type { ReplyRef, VoiceRecording } from './core/store';
import type { Contact, MessageAttachment, NodeStatus, PlainMessage } from './core/types';
import { dayLabel, fileSize, formatTime, expiryLabel } from './core/format';
import {
  Alert, ArrowUp, Block, ChevronLeft, ChevronUp, Close, Copy, Doc, DocText, Download, Info, Lock, LockFill, Mic, Pencil, Plus,
  Reply, ShieldAlert, Spinner, TableIcon, Trash, VerifiedSeal, Check, Clock, More, Photo, Smile,
} from './icons';
import { CAP_MESSAGE_DELETE } from '@kant/core';
import { openExternalUrl } from '../lib/fileActions';
import { ChatText, DeleteSheet, FormatBar, ReactionBar, ReactionChips, useBubbleGestures } from './chat/ChatParts';
import { applyFormat, formatForShortcut, plainText, toggledReaction } from './chat/chatLogic';
import type { FormatKind } from './chat/chatLogic';
import { useChatPrefs } from './chat/prefs';
import { copyText, displayName, isTouch, seenLabel, shortId, useLongPress } from './lib';
import { Avatar, Confirm, Menu, useToast } from './parts';
import type { MenuItem } from './parts';
import { FilePreview } from './FilePreview';
import { FileEditor } from './FileEditor';
import type { EditorSource } from './FileEditor';
import { displayFileName } from './preview/sanitize';
import { blankGrid } from './preview/tableEdit';
import { VoiceNote } from './VoiceNote';
import { LOCK_DISTANCE, RecordingPanel, ReviewPanel, useVoiceCapture } from './VoiceComposer';
import { canRecordVoice } from './voice/recorder';

type EditTarget = { id: string; text: string };

/** Your own text message that is out of the sending pipeline can be edited. */
function canEdit(m: PlainMessage): boolean {
  return m.from === 'me' && !!m.text && !m.attachments?.length && !m.system && !m.deletedAt
    && (m.status === 'sent' || m.status === 'delivered' || m.status === 'read');
}

const isAudio = (a: MessageAttachment) => !!a.voice || a.mime.startsWith('audio/');

const NEW_FILES: Record<'table' | 'document', { source: EditorSource; name: string; title: string }> = {
  table: { source: { kind: 'table', grid: blankGrid(4, 3), delimiter: ',', lineEnding: '\r\n' }, name: 'Table.csv', title: 'New table' },
  document: { source: { kind: 'text', text: '', flavor: 'markdown' }, name: 'Document.md', title: 'New document' },
};

type Target = { kind: 'dm'; contact: Contact } | { kind: 'group'; groupId: string };

/** Unsent text per chat, kept for the session so switching chats never loses a draft. */
const drafts = new Map<string, string>();

export function Conversation({ target, status, onBack, onInfo, onVerify, showBack }: {
  target: Target; status: NodeStatus; onBack: () => void; onInfo: () => void; onVerify: () => void; showBack: boolean;
}) {
  const store = useStore();
  const { state } = store;
  const toast = useToast();
  const isDm = target.kind === 'dm';
  const contact = isDm ? target.contact : null;
  const group = !isDm ? state.groups.find((g) => g.id === target.groupId) : null;
  const threadKey = isDm ? contact!.id! : target.groupId;
  const messages: PlainMessage[] = (isDm ? state.threads[threadKey] : state.groupThreads[threadKey]) ?? [];

  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[]; header?: ReactNode } | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PlainMessage | null>(null);
  const prefs = useChatPrefs();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  const [creating, setCreating] = useState<'table' | 'document' | null>(null);
  const [autoplayId, setAutoplayId] = useState<string | null>(null);
  const [ackKeyChange, setAckKeyChange] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const connected = status === 'relay' || status === 'onion' || status === 'direct';
  const title = isDm ? displayName(contact) : group?.name ?? 'Group';
  const isRequest = !!contact?.request;

  /* Keep the thread pinned to the newest message unless the reader scrolled up. */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, threadKey]);
  useEffect(() => {
    stickRef.current = true; setReplyTo(null); setEditing(null); setAutoplayId(null); setAckKeyChange(false);
  }, [threadKey]);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const repin = () => { const el = scrollRef.current; if (el && stickRef.current) el.scrollTop = el.scrollHeight; };
    vv.addEventListener('resize', repin);
    return () => vv.removeEventListener('resize', repin);
  }, []);

  const nameOf = useCallback((from: string) => {
    if (from === 'me') return 'You';
    if (isDm) return displayName(contact);
    const c = state.contacts.find((x) => x.publicKeyHex === from);
    return c ? displayName(c) : `Kant ${shortId(from)}`;
  }, [isDm, contact, state.contacts]);

  /** Who wrote a quoted message, in this reader's words ("You", their name) when we have it. */
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const quoteAuthor = (ref: { id: string; from: string }) => {
    const quoted = byId.get(ref.id);
    return quoted ? nameOf(quoted.from) : ref.from;
  };

  const quoteText = (m: PlainMessage) => {
    if (m.text) return m.text;
    const a = m.attachments?.[0];
    if (a?.voice) return 'Voice message';
    if (a?.mime.startsWith('image/')) return 'Photo';
    return a ? displayFileName(a.name) : 'Attachment';
  };

  const retry = (m: PlainMessage) => {
    void store.retryMessage(contact!.id!, m.id).then((r) => {
      if (r === 'waiting') toast(`${title} isn’t reachable yet — Kant keeps trying`, <Clock size={18} />);
    }).catch(() => {});
  };

  const startReply = (m: PlainMessage) => {
    setEditing(null);
    setReplyTo({ id: m.id, from: nameOf(m.from), text: quoteText(m) });
  };

  const canReact = (m: PlainMessage) => !isRequest && !m.deletedAt && !m.system && !m.id.startsWith('pending-');
  const react = (m: PlainMessage, emoji: string) => {
    const next = toggledReaction(m.reactions?.me, emoji);
    const done = isDm ? store.reactToMessage(contact!.id!, m.id, next) : store.reactGroupMessage(target.groupId, m.id, next);
    void done.then((ok) => { if (!ok) toast('Couldn’t react to that message', <Alert size={18} />); })
      .catch(() => toast('Couldn’t react to that message', <Alert size={18} />));
  };
  const reactionBar = (m: PlainMessage) => (
    <ReactionBar current={m.reactions?.me} onPick={(emoji) => { setMenu(null); react(m, emoji); }} />
  );

  const openLink = (href: string) => {
    if (prefs.confirmLinks) { setPendingLink(href); return; }
    void openExternalUrl(href).then((ok) => { if (!ok) toast('This link can’t be opened', <Alert size={18} />); })
      .catch(() => toast('This link can’t be opened', <Alert size={18} />));
  };

  /** Their Kant must understand deletions for "Delete for everyone" to mean anything. */
  const peerCanDelete = !isDm || !!contact?.caps?.includes(CAP_MESSAGE_DELETE);
  const deleteMessage = (m: PlainMessage, forEveryone: boolean) => {
    const done = isDm ? store.deleteMessage(contact!.id!, m.id, forEveryone) : store.deleteGroupMessage(target.groupId, m.id, forEveryone);
    void done.then((ok) => { if (!ok) toast('Couldn’t delete the message', <Alert size={18} />); else toast('Deleted', <Trash size={18} />); })
      .catch(() => toast('Couldn’t delete the message', <Alert size={18} />));
    if (replyTo?.id === m.id) setReplyTo(null);
    if (editing?.id === m.id) setEditing(null);
  };

  const startEdit = (m: PlainMessage) => {
    setReplyTo(null);
    setEditing({ id: m.id, text: m.text });
  };

  const openMenu = (m: PlainMessage, at: { x: number; y: number }) => {
    const items: MenuItem[] = [];
    if (m.id.startsWith('pending-')) return;
    if (!m.deletedAt) {
      if (!isRequest) items.push({ label: 'Reply', icon: <Reply size={20} />, onSelect: () => startReply(m) });
      if (!isRequest && canEdit(m)) items.push({ label: 'Edit', icon: <Pencil size={20} />, onSelect: () => startEdit(m) });
      if (m.text) items.push({ label: 'Copy', icon: <Copy size={20} />, onSelect: () => { void copyText(m.text); toast('Copied', <Check size={18} />); } });
      if (m.status === 'failed' && isDm && m.text) items.push({ label: 'Retry now', icon: <ArrowUp size={20} />, onSelect: () => retry(m) });
    }
    if (!m.system) items.push({ label: 'Delete', icon: <Trash size={20} />, danger: true, onSelect: () => setDeleting(m) });
    if (items.length) setMenu({ at, items, header: canReact(m) ? reactionBar(m) : undefined });
  };
  const openReactions = (m: PlainMessage, at: { x: number; y: number }) => {
    if (canReact(m)) setMenu({ at, items: [], header: reactionBar(m) });
  };

  const send = (text: string) => {
    if (isDm) store.send(contact!.id!, text, replyTo ?? undefined);
    else store.sendGroup(target.groupId, text, replyTo ?? undefined);
    setReplyTo(null);
    stickRef.current = true;
  };
  const sendFile = (file: File) => {
    if (isDm) store.sendFile(contact!.id!, file); else store.sendGroupFile(target.groupId, file);
    stickRef.current = true;
  };
  const sendVoice = (recording: VoiceRecording) => {
    if (isDm) store.sendVoice(contact!.id!, recording); else store.sendGroupVoice(target.groupId, recording);
    stickRef.current = true;
  };
  const submitEdit = (text: string) => {
    const target0 = editing;
    setEditing(null);
    if (!target0 || text === target0.text) return;
    const done = isDm ? store.editMessage(contact!.id!, target0.id, text) : store.editGroupMessage(target.groupId, target0.id, text);
    void done.then((ok) => { if (!ok) toast('Couldn’t edit the message', <Alert size={18} />); })
      .catch(() => toast('Couldn’t edit the message', <Alert size={18} />));
  };
  /** Desktop: ↑ in an empty composer edits your last message, as in most chat apps. */
  const editLast = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (canEdit(messages[i])) { startEdit(messages[i]); return true; }
      if (messages[i].from === 'me') return false;
    }
    return false;
  };

  /** When a voice note finishes, play the one right after it (like a playlist of replies). */
  const playNextAfter = (id: string) => {
    const i = messages.findIndex(m => m.id === id);
    const next = i >= 0 ? messages[i + 1] : undefined;
    setAutoplayId(next?.attachments?.some(a => !!a.voice) ? next.id : null);
  };

  const sub = isDm
    ? (isRequest ? 'Not in your contacts' : seenLabel(contact!) || 'Tap for contact info')
    : `${group?.memberKeys.length ?? 0} members`;

  return (
    <div className="k-pane">
      <header className="k-bar k-conv-head is-lined">
        {showBack && (
          <button type="button" className="k-back" onClick={onBack} aria-label="Back to chats"><ChevronLeft size={26} /></button>
        )}
        <button type="button" className="k-conv-who" onClick={onInfo} aria-label={`${title} — info`}>
          <Avatar name={isDm ? contact!.nickname ?? '' : ''} seed={isDm ? contact!.publicKeyHex : target.groupId} size={38}
            group={!isDm} online={isDm && contact!.online} />
          <span style={{ minWidth: 0 }}>
            <span className="k-conv-name">{title}{contact?.trust === 'verified' && <VerifiedSeal size={15} className="k-verified" />}</span>
            <span className={`k-conv-sub${isDm && contact!.online ? ' is-online' : ''}`}>{sub}</span>
          </span>
        </button>
        <button type="button" className="k-icon-btn" onClick={onInfo} aria-label="Info"><Info size={23} /></button>
      </header>

      {contact?.trust === 'changed' && !ackKeyChange && (
        <div className="k-callout is-danger" role="alert">
          <h3><ShieldAlert size={19} /> {title}’s safety code changed</h3>
          <p>This happens when someone reinstalls Kant or changes phone — and it’s also what an impostor would look like. Verify before sharing anything sensitive.</p>
          <div className="k-callout-actions">
            <button type="button" className="k-btn k-btn-secondary" onClick={() => setAckKeyChange(true)}>Not now</button>
            <button type="button" className="k-btn k-btn-primary" onClick={onVerify}>Verify</button>
          </div>
        </div>
      )}

      <div className="k-thread" ref={scrollRef}
        onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="k-thread-inner">
          <div className="k-e2e">
            <LockFill size={13} />
            {isDm ? <>Messages are end-to-end encrypted. Only you and {title} can read them.</> : <>Messages in this group are end-to-end encrypted.</>}
            {isDm && !isRequest && contact!.trust !== 'verified' && (
              <> <button type="button" onClick={onVerify}>Verify {title}</button></>
            )}
          </div>

          {(() => {
            let lastOut = -1;
            for (let j = messages.length - 1; j >= 0; j--) if (messages[j].from === 'me') { lastOut = j; break; }
            return messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
            const grouped = !!prev && !newDay && prev.from === m.from && m.ts - prev.ts < 3 * 60_000;
            const last = !next || next.from !== m.from || next.ts - m.ts >= 3 * 60_000
              || new Date(next.ts).toDateString() !== new Date(m.ts).toDateString();
            const isLastOutgoing = i === lastOut;
            return (
              <MessageRow key={m.id} m={m} grouped={grouped} last={last} newDay={newDay}
                senderName={!isDm && m.from !== 'me' && !grouped ? nameOf(m.from) : undefined}
                showStatus={isDm && isLastOutgoing}
                isEditing={editing?.id === m.id}
                autoPlay={autoplayId === m.id}
                onVoiceEnded={() => playNextAfter(m.id)}
                onMenu={(at) => openMenu(m, at)} onOpenImage={setLightbox} onOpenFile={setPreview}
                onReactMenu={canReact(m) ? (at) => openReactions(m, at) : undefined}
                onReact={canReact(m) ? (emoji) => react(m, emoji) : undefined}
                onReply={!isRequest && !m.deletedAt && !m.id.startsWith('pending-') ? () => startReply(m) : undefined}
                onLink={openLink} nameOf={nameOf} quoteAuthor={m.replyTo ? quoteAuthor(m.replyTo) : undefined}
                onRetry={isDm && m.text && !m.deletedAt ? () => retry(m) : undefined} />
            );
            });
          })()}
        </div>
      </div>

      {isRequest ? (
        <RequestBar contact={contact!} />
      ) : (
        <Composer key={threadKey} draftKey={threadKey} connected={connected} status={status}
          replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
          editing={editing} onCancelEdit={() => setEditing(null)} onSubmitEdit={submitEdit} onEditLast={editLast}
          onSend={send} onSendFile={sendFile} onSendVoice={sendVoice} onCreate={setCreating} />
      )}

      {menu && <Menu at={menu.at} items={menu.items} header={menu.header} onClose={() => setMenu(null)} />}
      {deleting && (
        <DeleteSheet
          forEveryone={deleting.from === 'me' && !deleting.deletedAt && !isRequest && peerCanDelete && !deleting.id.startsWith('pending-')}
          everyoneUnavailable={deleting.from === 'me' && !deleting.deletedAt && !peerCanDelete
            ? `${title}’s Kant is out of date, so this can only be deleted from your device.` : undefined}
          onDelete={(forEveryone) => deleteMessage(deleting, forEveryone)}
          onClose={() => setDeleting(null)} />
      )}
      {pendingLink && (
        <Confirm title="Open this link?" confirmLabel="Open link" onClose={() => setPendingLink(null)}
          message={<>
            <span className="k-preview-url">{pendingLink}</span>
            It opens outside Kant. The site will see your IP address.
          </>}
          onConfirm={() => {
            void openExternalUrl(pendingLink).then((ok) => { if (!ok) toast('This link can’t be opened', <Alert size={18} />); })
              .catch(() => toast('This link can’t be opened', <Alert size={18} />));
          }} />
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {preview && <FilePreview attachment={preview} onClose={() => setPreview(null)} onSendEdited={isRequest ? undefined : sendFile} />}
      {creating && (
        <FileEditor source={NEW_FILES[creating].source} name={NEW_FILES[creating].name} title={NEW_FILES[creating].title} isNew
          onSend={connected ? sendFile : undefined} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}

/* ── Message ──────────────────────────────────────────────────────── */

function MessageRow({
  m, grouped, last, newDay, senderName, showStatus, isEditing, autoPlay, onVoiceEnded, onMenu, onOpenImage, onOpenFile, onRetry,
  onReactMenu, onReact, onReply, onLink, nameOf, quoteAuthor,
}: {
  m: PlainMessage; grouped: boolean; last: boolean; newDay: boolean; senderName?: string; showStatus: boolean;
  isEditing: boolean; autoPlay: boolean; onVoiceEnded: () => void;
  onMenu: (at: { x: number; y: number }) => void; onOpenImage: (src: string) => void;
  onOpenFile: (attachment: MessageAttachment) => void; onRetry?: () => void;
  /** Open just the reaction bar (desktop hover button). */
  onReactMenu?: (at: { x: number; y: number }) => void;
  /** Toggle a reaction; absent when this message can't be reacted to. */
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onLink: (href: string) => void;
  nameOf: (who: string) => string;
  quoteAuthor?: string;
}) {
  const out = m.from === 'me';
  const prefs = useChatPrefs();
  const { pressed, handlers, justFired } = useLongPress(onMenu);
  const gestures = useBubbleGestures({
    swipe: prefs.swipeReply && !!onReply,
    doubleTap: prefs.doubleTapReact && !!onReact,
    onSwipe: () => onReply?.(),
    onDoubleTap: () => onReact?.(prefs.quickReaction),
  });
  const image = m.attachments?.find((a) => a.mime.startsWith('image/'));
  const audio = m.attachments?.filter(isAudio) ?? [];
  const files = m.attachments?.filter((a) => !a.mime.startsWith('image/') && !isAudio(a)) ?? [];
  const voiceOnly = audio.length > 0 && !m.text && !m.replyTo && !image && !files.length;
  const touch = isTouch();

  const bubbleHandlers = touch ? {
    onTouchStart: (e: React.TouchEvent) => { handlers.onTouchStart(e); gestures.handlers.onTouchStart(e); },
    onTouchMove: (e: React.TouchEvent) => { handlers.onTouchMove(e); gestures.handlers.onTouchMove(e); },
    onTouchEnd: (e: React.TouchEvent) => { handlers.onTouchEnd(); gestures.handlers.onTouchEnd(e); },
    onTouchCancel: () => { handlers.onTouchCancel(); gestures.handlers.onTouchCancel(); },
  } : {};

  return (
    <>
      {newDay && <div className="k-day">{dayLabel(m.ts)}</div>}
      {senderName && <div className="k-sender">{senderName}</div>}
      <div className={`k-msg ${out ? 'out' : 'in'}${grouped ? ' is-grouped' : ''}${last ? ' is-last' : ''}${m.status === 'failed' && !m.deletedAt ? ' is-failed' : ''}${isEditing ? ' is-editing' : ''}`}>
        {gestures.offset > 0 && (
          <span className="k-swipe-reply" aria-hidden="true" style={{ opacity: Math.min(1, gestures.offset / 56), transform: `scale(${0.6 + Math.min(0.4, gestures.offset / 140)})` }}>
            <Reply size={18} />
          </span>
        )}
        <div className="k-bubble-row" style={gestures.offset ? { transform: `translateX(${gestures.offset}px)`, transition: 'none' } : undefined}>
          {m.deletedAt ? (
            <div className="k-bubble is-deleted" {...bubbleHandlers}
              onContextMenu={(e) => { e.preventDefault(); if (!justFired()) onMenu({ x: e.clientX, y: e.clientY }); }}>
              <Trash size={15} /> {out ? 'You deleted this message' : 'This message was deleted'}
            </div>
          ) : (
          <div className={`k-bubble${image && !m.text && !m.replyTo ? ' has-image' : ''}${voiceOnly ? ' has-voice' : ''}${pressed ? ' is-pressed' : ''}`}
            {...bubbleHandlers}
            onContextMenu={(e) => { e.preventDefault(); if (!justFired()) onMenu({ x: e.clientX, y: e.clientY }); }}>
            {m.replyTo && (
              <span className="k-quote"><b>{quoteAuthor ?? m.replyTo.from}</b><span>{m.replyTo.text ? plainText(m.replyTo.text) : <i>Deleted message</i>}</span></span>
            )}
            {image && <ImageAttachment attachment={image} onOpen={onOpenImage} />}
            {audio.map((a) => (
              <VoiceNote key={a.fileId ?? a.name} attachment={a} out={out} autoPlay={autoPlay && !!a.voice}
                onEnded={a.voice ? onVoiceEnded : undefined} ignoreClick={justFired}
                onOpenFile={a.voice ? undefined : () => { if (!justFired()) onOpenFile(a); }} />
            ))}
            {files.map((a) => (
              <FileAttachment key={a.fileId ?? a.name} attachment={a}
                // A long-press that just opened the menu must not also open the preview.
                onOpen={() => { if (!justFired()) onOpenFile(a); }} />
            ))}
            {m.text && (image
              ? <span className="k-image-caption" style={{ display: 'block' }}><ChatText text={m.text} onLink={onLink} /></span>
              : <ChatText text={m.text} onLink={onLink} />)}
            {m.editedAt && m.text && <span className="k-edited" title={`Edited ${formatTime(m.editedAt)}`}>edited</span>}
          </div>
          )}
          <span className="k-msg-tools">
            {onReactMenu && (
              <button type="button" className="k-msg-more" aria-label="React"
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onReactMenu({ x: r.left - 120, y: r.top - 58 }); }}>
                <Smile size={18} />
              </button>
            )}
            {onReply && (
              <button type="button" className="k-msg-more" aria-label="Reply" onClick={onReply}>
                <Reply size={18} />
              </button>
            )}
            <button type="button" className="k-msg-more" aria-label="Message actions"
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu({ x: r.left, y: r.bottom + 4 }); }}>
              <More size={18} />
            </button>
          </span>
        </div>
        {!m.deletedAt && <ReactionChips reactions={m.reactions} nameOf={nameOf} onToggle={onReact} />}
        {(last || (m.status === 'failed' && !m.deletedAt)) && (
          <MetaLine m={m} out={out} showStatus={showStatus && !m.deletedAt} onRetry={onRetry} />
        )}
      </div>
    </>
  );
}

function MetaLine({ m, out, showStatus, onRetry }: { m: PlainMessage; out: boolean; showStatus: boolean; onRetry?: () => void }) {
  if (m.status === 'failed' && out && !m.deletedAt) {
    return (
      <div className="k-meta k-meta-fail"><Alert size={13} /> Not delivered yet{onRetry && <> · <button type="button" onClick={onRetry}>Retry now</button></>}</div>
    );
  }
  const statusLabel: Record<string, ReactNode> = {
    pending: <><Spinner size={11} /> Sending…</>,
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
  };
  return (
    <div className="k-meta">
      {m.expiresAt && <><Clock size={12} /> {expiryLabel(m.expiresAt)} · </>}
      {formatTime(m.ts)}
      {out && showStatus && <> · {statusLabel[m.status]}</>}
    </div>
  );
}

/* ── Attachments ──────────────────────────────────────────────────── */

function useAttachmentUrl(attachment: MessageAttachment, eager: boolean) {
  const store = useStore();
  const [url, setUrl] = useState<string | null>(attachment.thumbnail ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const objectUrl = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (objectUrl.current) return objectUrl.current;
    if (!attachment.fileId) return null;
    setState('loading');
    try {
      const next = await store.loadAttachment(attachment);
      if (next) { objectUrl.current = next; setUrl(next); setState('idle'); } else setState('error');
      return next;
    } catch { setState('error'); return null; }
  }, [attachment, store]);
  useEffect(() => {
    if (eager && attachment.fileId) void load();
    return () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; };
    // Keyed by the encrypted blob id — live store updates must not re-decrypt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.fileId]);
  return { url, state, load };
}

function ImageAttachment({ attachment, onOpen }: { attachment: MessageAttachment; onOpen: (src: string) => void }) {
  const { url, state } = useAttachmentUrl(attachment, true);
  if (!url) {
    return (
      <span className="k-attach">
        <span className="k-attach-icon">{state === 'error' ? <Alert size={20} /> : <Spinner size={20} />}</span>
        <span style={{ minWidth: 0 }}>
          <span className="k-attach-name" style={{ display: 'block' }}>{attachment.name || 'Photo'}</span>
          <span className="k-attach-size">{state === 'error' ? 'Couldn’t open' : 'Decrypting…'}</span>
        </span>
      </span>
    );
  }
  return <img className="k-image" src={url} alt={attachment.name || 'Photo'} onClick={() => onOpen(url)} />;
}

function FileAttachment({ attachment, onOpen }: { attachment: MessageAttachment; onOpen: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const ok = await store.downloadAttachment(attachment);
      toast(ok ? 'Saved' : 'Couldn’t save the file', ok ? <Check size={18} /> : <Alert size={18} />);
    } finally { setBusy(false); }
  };
  const name = displayFileName(attachment.name);
  return (
    <span className="k-attach">
      <button type="button" className="k-attach-open" onClick={onOpen} aria-label={`Preview ${name}`}>
        <span className="k-attach-icon"><Doc size={20} /></span>
        <span style={{ minWidth: 0 }}>
          <span className="k-attach-name" style={{ display: 'block' }}>{name}</span>
          <span className="k-attach-size">{fileSize(attachment.size)}</span>
        </span>
      </button>
      <button type="button" className="k-attach-dl" onClick={download} disabled={busy} aria-label={`Save ${name}`}>
        {busy ? <Spinner size={16} /> : <Download size={17} />}
      </button>
    </span>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="k-lightbox" onClick={onClose} role="dialog" aria-label="Photo">
      <div className="k-lightbox-bar">
        <button type="button" className="k-icon-btn" onClick={onClose} aria-label="Close"><Close size={24} /></button>
      </div>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

/* ── Request bar ──────────────────────────────────────────────────── */

function RequestBar({ contact }: { contact: Contact }) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  return (
    <div className="k-composer">
      <div className="k-composer-inner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <p className="k-footnote k-muted k-center">
          <b style={{ color: 'var(--text)' }}>{displayName(contact)}</b> isn’t in your contacts. Accept to reply — only do this if you know who they are.
        </p>
        <input className="k-field" style={{ minHeight: 44 }} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Give them a name (optional)" aria-label="Name" maxLength={40} />
        <div className="k-callout-actions">
          <button type="button" className="k-btn k-btn-danger" onClick={() => { store.blockContact(contact.id!, true); toast('Blocked', <Block size={18} />); }}>Block</button>
          <button type="button" className="k-btn k-btn-primary" onClick={() => { store.acceptRequest(contact.id!, name); toast('Added to contacts', <Check size={18} />); }}>Accept</button>
        </div>
      </div>
    </div>
  );
}

/* ── Composer ─────────────────────────────────────────────────────── */

function Composer({
  draftKey, connected, status, replyTo, onCancelReply, editing, onCancelEdit, onSubmitEdit, onEditLast,
  onSend, onSendFile, onSendVoice, onCreate,
}: {
  draftKey: string; connected: boolean; status: NodeStatus;
  replyTo: ReplyRef | null; onCancelReply: () => void;
  editing: EditTarget | null; onCancelEdit: () => void; onSubmitEdit: (text: string) => void; onEditLast: () => boolean;
  onSend: (text: string) => void; onSendFile: (file: File) => void; onSendVoice: (recording: VoiceRecording) => void;
  onCreate: (kind: 'table' | 'document') => void;
}) {
  const toast = useToast();
  const [value, setValueState] = useState(() => drafts.get(draftKey) ?? '');
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // While editing, the box holds the message being edited — never save that as the chat's draft.
  const setValue = (v: string) => {
    setValueState(v);
    if (editingRef.current) return;
    if (v) drafts.set(draftKey, v); else drafts.delete(draftKey);
  };
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [attachMenu, setAttachMenu] = useState<{ x: number; y: number } | null>(null);
  const canRecord = useMemo(canRecordVoice, []);
  const prefs = useChatPrefs();
  const [hasSelection, setHasSelection] = useState(false);
  const trackSelection = () => {
    const el = taRef.current;
    setHasSelection(!!el && document.activeElement === el && el.selectionEnd > el.selectionStart);
  };
  const format = (kind: FormatKind) => {
    const el = taRef.current;
    if (!el) return;
    const edit = applyFormat(el.value, el.selectionStart, el.selectionEnd, kind);
    setValue(edit.value);
    requestAnimationFrame(() => {
      const t = taRef.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(edit.start, edit.end);
      resize(t);
      setHasSelection(edit.end > edit.start);
    });
  };

  const capture = useVoiceCapture({
    onSend: (recording) => onSendVoice(recording),
    onError: (message) => toast(message, <Alert size={18} />),
    onNotice: (message) => toast(message, <Mic size={18} />),
  });
  // The click that trails a mic press/release must not act on the button the mic just turned into.
  const micPress = useRef(false);
  const ignoreClicksUntil = useRef(0);
  const endMicPress = () => { if (micPress.current) { micPress.current = false; ignoreClicksUntil.current = performance.now() + 400; } };
  const recording = capture.phase === 'starting' || capture.phase === 'recording' || capture.phase === 'stopping';
  const reviewing = capture.phase === 'review' && !!capture.review;
  const capturing = recording || reviewing;
  const holding = recording && !capture.locked;

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  useEffect(() => { if (replyTo) taRef.current?.focus(); }, [replyTo]);

  // Entering edit mode loads the message into the box; leaving it restores the draft.
  const editingId = editing?.id;
  useEffect(() => {
    if (editing) {
      setValueState(editing.text);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        resize(el);
      });
    } else {
      setValueState(drafts.get(draftKey) ?? '');
      requestAnimationFrame(() => resize(taRef.current));
    }
    // Keyed by which message is being edited, not by its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Escape abandons a recording in progress.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); capture.cancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capturing, capture]);

  const trimmed = value.trim();
  const submit = () => {
    if (editing) {
      if (!trimmed) return;
      onSubmitEdit(trimmed);
      if (taRef.current) { taRef.current.style.height = 'auto'; taRef.current.focus(); }
      return;
    }
    if (!trimmed || !connected) return;
    onSend(trimmed);
    setValue('');
    if (taRef.current) { taRef.current.style.height = 'auto'; taRef.current.focus(); }
  };
  const pick = (input: HTMLInputElement | null) => input?.click();
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onSendFile(f);
  };

  // One button to the right of the box: mic when empty, send when there's text,
  // a check while editing — and the same element all through a held recording,
  // so the pointer capture that drives slide-to-cancel is never lost.
  const mode: 'send' | 'edit' | 'mic' | 'hold' | 'send-voice' =
    capturing ? (holding ? 'hold' : 'send-voice')
      : editing ? 'edit'
      : trimmed || !canRecord ? 'send' : 'mic';
  const actionDisabled =
    mode === 'send' ? !trimmed || !connected
      : mode === 'edit' ? !trimmed || trimmed === editing?.text
      : mode === 'mic' ? !connected
      : mode === 'send-voice' ? capture.phase === 'starting' || capture.phase === 'stopping' || !connected
      : false;
  const actionLabel = mode === 'edit' ? 'Save edit' : mode === 'mic' ? 'Record voice message — hold to talk, tap to record hands-free'
    : mode === 'hold' ? 'Recording — release to send' : mode === 'send-voice' ? 'Send voice message' : 'Send';

  return (
    <div className={`k-composer${capturing ? ' is-capturing' : ''}`}>
      {!connected && (
        <p className="k-composer-note">
          {status === 'connecting' ? 'Connecting… you can send in a moment.' : 'You’re offline. Messages can be sent once you reconnect.'}
        </p>
      )}
      {editing ? (
        <div className="k-reply-preview is-edit">
          <Pencil size={17} />
          <div><b>Edit message</b><span>{plainText(editing.text)}</span></div>
          <button type="button" className="k-icon-btn is-muted" style={{ width: 30, height: 30 }} onClick={onCancelEdit} aria-label="Cancel editing"><Close size={18} /></button>
        </div>
      ) : replyTo && (
        <div className="k-reply-preview">
          <div><b>Replying to {replyTo.from}</b><span>{plainText(replyTo.text)}</span></div>
          <button type="button" className="k-icon-btn is-muted" style={{ width: 30, height: 30 }} onClick={onCancelReply} aria-label="Cancel reply"><Close size={18} /></button>
        </div>
      )}
      {prefs.formatBar && hasSelection && !capturing && <FormatBar onFormat={format} />}
      <div className="k-composer-inner">
        {capturing && (capture.locked || reviewing) ? (
          <button type="button" className="k-attach-btn is-danger" aria-label="Delete recording" onClick={capture.cancel}>
            <Trash size={19} />
          </button>
        ) : (
          <button type="button" className="k-attach-btn" aria-label="Attach" disabled={!connected || !!editing || capturing}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAttachMenu({ x: r.left, y: r.top - 206 }); }}>
            <Plus size={20} stroke={2.4} />
          </button>
        )}
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={onFiles} />
        <input ref={fileRef} type="file" hidden onChange={onFiles} />
        {recording ? (
          <RecordingPanel capture={capture} onStop={capture.stopToReview} />
        ) : reviewing ? (
          <ReviewPanel recording={capture.review!} />
        ) : (
          <div className="k-input-pill">
            <textarea ref={taRef} rows={1} value={value} placeholder={editing ? 'Edit message' : 'Message'} aria-label={editing ? 'Edit message' : 'Message'}
              onChange={(e) => { setValue(e.target.value); resize(e.target); trackSelection(); }}
              onSelect={trackSelection}
              // Deferred: on a phone, tapping a format button blurs the box first.
              onBlur={() => window.setTimeout(trackSelection, 180)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                const shortcut = formatForShortcut(e.key, e.ctrlKey || e.metaKey, e.shiftKey);
                if (shortcut) { e.preventDefault(); format(shortcut); return; }
                if (e.key === 'Escape' && editing) { e.preventDefault(); e.stopPropagation(); onCancelEdit(); return; }
                if (e.key === 'ArrowUp' && !value && !editing && !isTouch()) { if (onEditLast()) e.preventDefault(); return; }
                // Desktop: Enter sends, Shift+Enter adds a line. Phones keep Return for new lines.
                if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); submit(); }
              }} />
          </div>
        )}
        <div className="k-composer-action">
          {holding && capture.phase === 'recording' && (
            <span className="k-rec-lock" aria-hidden="true"
              style={{ transform: `translateY(${Math.max(-LOCK_DISTANCE, capture.dragY)}px)`, opacity: 0.55 + Math.min(0.45, -capture.dragY / LOCK_DISTANCE) }}>
              <Lock size={15} /><ChevronUp size={13} />
            </span>
          )}
          <button type="button" className={`k-action k-action-${mode}`} disabled={actionDisabled} aria-label={actionLabel}
            onPointerDown={mode === 'mic' ? (e) => { micPress.current = true; capture.pointer.onPointerDown(e); } : undefined}
            onPointerMove={capture.pointer.onPointerMove}
            onPointerUp={(e) => { endMicPress(); capture.pointer.onPointerUp(e); }}
            onPointerCancel={(e) => { endMicPress(); capture.pointer.onPointerCancel(e); }}
            onContextMenu={(e) => { if (mode === 'mic' || mode === 'hold') e.preventDefault(); }}
            onClick={(e) => {
              if (performance.now() < ignoreClicksUntil.current) return;
              if (mode === 'send' || mode === 'edit') submit();
              else if (mode === 'send-voice') capture.send();
              // Keyboard activation of the mic (no pointer involved) starts a hands-free recording.
              else if (mode === 'mic' && e.detail === 0) capture.start(true);
            }}>
            {mode === 'edit' ? <Check size={18} /> : mode === 'mic' || mode === 'hold' ? <Mic size={19} stroke={2.1} /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>
      {attachMenu && (
        <Menu at={attachMenu} onClose={() => setAttachMenu(null)} items={[
          { label: 'Photo', icon: <Photo size={20} />, onSelect: () => pick(photoRef.current) },
          { label: 'File', icon: <Doc size={20} />, onSelect: () => pick(fileRef.current) },
          { label: 'New table', icon: <TableIcon size={20} />, onSelect: () => onCreate('table') },
          { label: 'New document', icon: <DocText size={20} />, onSelect: () => onCreate('document') },
        ]} />
      )}
    </div>
  );
}
