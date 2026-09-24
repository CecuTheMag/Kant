/**
 * A single conversation — one-to-one or group. Header, message thread,
 * request / key-change prompts and the composer.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from './core/store';
import type { ReplyRef } from './core/store';
import type { Contact, MessageAttachment, NodeStatus, PlainMessage } from './core/types';
import { dayLabel, fileSize, formatTime, expiryLabel } from './core/format';
import {
  Alert, ArrowUp, Block, ChevronLeft, Close, Copy, Doc, Download, Info, LockFill, Plus, Reply, ShieldAlert,
  Spinner, VerifiedSeal, Check, Clock, More, Photo,
} from './icons';
import { copyText, displayName, isTouch, seenLabel, shortId, useLongPress } from './lib';
import { Avatar, Menu, useToast } from './parts';
import type { MenuItem } from './parts';

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
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
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
  useEffect(() => { stickRef.current = true; setReplyTo(null); setAckKeyChange(false); }, [threadKey]);
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

  const openMenu = (m: PlainMessage, at: { x: number; y: number }) => {
    const items: MenuItem[] = [];
    if (!isRequest) items.push({ label: 'Reply', icon: <Reply size={20} />, onSelect: () => setReplyTo({ id: m.id, from: nameOf(m.from), text: m.text || 'Attachment' }) });
    if (m.text) items.push({ label: 'Copy', icon: <Copy size={20} />, onSelect: () => { void copyText(m.text); toast('Copied', <Check size={18} />); } });
    if (m.status === 'failed' && isDm) items.push({ label: 'Try again', icon: <ArrowUp size={20} />, onSelect: () => store.send(contact!.id!, m.text) });
    if (items.length) setMenu({ at, items });
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
                onMenu={(at) => openMenu(m, at)} onOpenImage={setLightbox}
                onRetry={isDm ? () => store.send(contact!.id!, m.text) : undefined} />
            );
            });
          })()}
        </div>
      </div>

      {isRequest ? (
        <RequestBar contact={contact!} />
      ) : (
        <Composer key={threadKey} draftKey={threadKey} connected={connected} status={status} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
          onSend={send} onSendFile={sendFile} />
      )}

      {menu && <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/* ── Message ──────────────────────────────────────────────────────── */

function MessageRow({ m, grouped, last, newDay, senderName, showStatus, onMenu, onOpenImage, onRetry }: {
  m: PlainMessage; grouped: boolean; last: boolean; newDay: boolean; senderName?: string; showStatus: boolean;
  onMenu: (at: { x: number; y: number }) => void; onOpenImage: (src: string) => void; onRetry?: () => void;
}) {
  const out = m.from === 'me';
  const { pressed, handlers, justFired } = useLongPress(onMenu);
  const image = m.attachments?.find((a) => a.mime.startsWith('image/'));
  const files = m.attachments?.filter((a) => !a.mime.startsWith('image/')) ?? [];

  return (
    <>
      {newDay && <div className="k-day">{dayLabel(m.ts)}</div>}
      {senderName && <div className="k-sender">{senderName}</div>}
      <div className={`k-msg ${out ? 'out' : 'in'}${grouped ? ' is-grouped' : ''}${last ? ' is-last' : ''}${m.status === 'failed' ? ' is-failed' : ''}`}>
        <div className="k-bubble-row">
          <div className={`k-bubble${image && !m.text && !m.replyTo ? ' has-image' : ''}${pressed ? ' is-pressed' : ''}`}
            {...(isTouch() ? handlers : {})}
            onContextMenu={(e) => { e.preventDefault(); if (!justFired()) onMenu({ x: e.clientX, y: e.clientY }); }}>
            {m.replyTo && (
              <span className="k-quote"><b>{m.replyTo.from}</b><span>{m.replyTo.text}</span></span>
            )}
            {image && <ImageAttachment attachment={image} onOpen={onOpenImage} />}
            {files.map((a) => <FileAttachment key={a.fileId ?? a.name} attachment={a} />)}
            {m.text && (image ? <span className="k-image-caption" style={{ display: 'block' }}>{m.text}</span> : m.text)}
          </div>
          <button type="button" className="k-msg-more" aria-label="Message actions"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu({ x: r.left, y: r.bottom + 4 }); }}>
            <More size={18} />
          </button>
        </div>
        {(last || m.status === 'failed') && (
          <MetaLine m={m} out={out} showStatus={showStatus} onRetry={onRetry} />
        )}
      </div>
    </>
  );
}

function MetaLine({ m, out, showStatus, onRetry }: { m: PlainMessage; out: boolean; showStatus: boolean; onRetry?: () => void }) {
  if (m.status === 'failed' && out) {
    return (
      <div className="k-meta k-meta-fail"><Alert size={13} /> Not delivered{onRetry && <> · <button type="button" onClick={onRetry}>Try again</button></>}</div>
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

function FileAttachment({ attachment }: { attachment: MessageAttachment }) {
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
  return (
    <span className="k-attach">
      <span className="k-attach-icon"><Doc size={20} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="k-attach-name" style={{ display: 'block' }}>{attachment.name || 'File'}</span>
        <span className="k-attach-size">{fileSize(attachment.size)}</span>
      </span>
      <button type="button" className="k-attach-dl" onClick={download} disabled={busy} aria-label={`Save ${attachment.name || 'file'}`}>
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

function Composer({ draftKey, connected, status, replyTo, onCancelReply, onSend, onSendFile }: {
  draftKey: string; connected: boolean; status: NodeStatus; replyTo: ReplyRef | null; onCancelReply: () => void;
  onSend: (text: string) => void; onSendFile: (file: File) => void;
}) {
  const [value, setValueState] = useState(() => drafts.get(draftKey) ?? '');
  const setValue = (v: string) => { setValueState(v); if (v) drafts.set(draftKey, v); else drafts.delete(draftKey); };
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [attachMenu, setAttachMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { if (replyTo) taRef.current?.focus(); }, [replyTo]);

  const resize = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; };
  const submit = () => {
    const text = value.trim();
    if (!text || !connected) return;
    onSend(text);
    setValue('');
    if (taRef.current) { taRef.current.style.height = 'auto'; taRef.current.focus(); }
  };
  const pick = (input: HTMLInputElement | null) => input?.click();
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onSendFile(f);
  };

  return (
    <div className="k-composer">
      {!connected && (
        <p className="k-composer-note">
          {status === 'connecting' ? 'Connecting… you can send in a moment.' : 'You’re offline. Messages can be sent once you reconnect.'}
        </p>
      )}
      {replyTo && (
        <div className="k-reply-preview">
          <div><b>Replying to {replyTo.from}</b><span>{replyTo.text}</span></div>
          <button type="button" className="k-icon-btn is-muted" style={{ width: 30, height: 30 }} onClick={onCancelReply} aria-label="Cancel reply"><Close size={18} /></button>
        </div>
      )}
      <div className="k-composer-inner">
        <button type="button" className="k-attach-btn" aria-label="Attach" disabled={!connected}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAttachMenu({ x: r.left, y: r.top - 110 }); }}>
          <Plus size={20} stroke={2.4} />
        </button>
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={onFiles} />
        <input ref={fileRef} type="file" hidden onChange={onFiles} />
        <div className="k-input-pill">
          <textarea ref={taRef} rows={1} value={value} placeholder="Message" aria-label="Message"
            onChange={(e) => { setValue(e.target.value); resize(e.target); }}
            onKeyDown={(e) => {
              // Desktop: Enter sends, Shift+Enter adds a line. Phones keep Return for new lines.
              if (e.key === 'Enter' && !e.shiftKey && !isTouch() && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }} />
          <button type="button" className="k-send" onClick={submit} disabled={!value.trim() || !connected} aria-label="Send">
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
      {attachMenu && (
        <Menu at={attachMenu} onClose={() => setAttachMenu(null)} items={[
          { label: 'Photo', icon: <Photo size={20} />, onSelect: () => pick(photoRef.current) },
          { label: 'File', icon: <Doc size={20} />, onSelect: () => pick(fileRef.current) },
        ]} />
      )}
    </div>
  );
}
