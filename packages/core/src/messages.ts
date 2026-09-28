/**
 * Kant Messages — Per-contact conversation persistence with at-rest encryption.
 *
 * At-rest key: derived from the Argon2id key (the same key that unlocks the
 * identity), NOT from the raw Ed25519 seed. This keeps the password in the
 * decryption chain — a seized IDB without the password cannot decrypt messages.
 */

import { getSodium } from './sodium.js';
import { openDB, idbGet, idbPut, idbDelete, idbGetAll } from './db.js';
import type { VoiceMeta } from './voice.js';

const STORE = 'messages';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
}

/** `failed` is durable so an undeliverable outbound message remains visible
 * after a reload and can be updated to `sent` when the offline queue flushes. */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  thumbnail?: string;
  display: 'inline' | 'attachment';
  /** Set when the attachment is a recorded voice note. */
  voice?: VoiceMeta;
}

export interface StoredMessage {
  id: string;
  fromMe: boolean;
  ciphertext: Uint8Array;
  timestamp: number;
  /** Monotonic per-conversation order, assigned when persisted. */
  sequenceNumber: number;
  status: MessageStatus;
  attachment?: MessageAttachment;
  /** Quoted-message reference. `ciphertext` here is the quoted snippet, encrypted
   *  the same way as the message body — a reply preview is still message content. */
  replyTo?: { id: string; from: string; ciphertext: Uint8Array };
  /** When the text was last replaced by an edit. */
  editedAt?: number;
  /** Reactions, `{ who: emoji }` ('me' or 'them'), encrypted like the text — they are content. */
  reactions?: Uint8Array;
  /** Set when the message was deleted for everyone: text, quote and attachment are gone. */
  deletedAt?: number;
  /**
   * Our changes to this message (edit / reaction / deletion) that the peer has
   * not acknowledged yet, by kind → the id of the control message carrying it.
   * Kept so a change survives a session reset or restart: it is re-sent from
   * the message's current state until the peer's receipt clears it.
   */
  unsynced?: Partial<Record<SyncKind, string>>;
}

export type SyncKind = 'edit' | 'react' | 'del';

export interface ConversationHeader {
  contactPubkeyHex: string;
  /** Messages are stored encrypted — use getConversation() to decrypt. */
  messages: StoredMessage[];
}

/** @deprecated Use ConversationHeader. Kept for type compatibility. */
export type Conversation = Omit<ConversationHeader, 'messages'> & {
  messages: (Omit<StoredMessage, 'replyTo' | 'reactions'> & {
    text?: string;
    replyTo?: { id: string; from: string; text: string };
    reactions?: Record<string, string>;
  })[];
};

/**
 * Derive the at-rest message encryption key from the Argon2id-derived key.
 * The derivedKey comes from unlockIdentity() — it is password-gated.
 */
async function deriveMessageKey(derivedKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_kdf_derive_from_key(32, 1, 'kantmsg\0', derivedKey);
}

async function encryptText(derivedKey: Uint8Array, text: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  const key    = await deriveMessageKey(derivedKey);
  const nonce  = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct     = sodium.crypto_secretbox_easy(new TextEncoder().encode(text), nonce, key);
  const combined = new Uint8Array(nonce.length + ct.length);
  combined.set(nonce);
  combined.set(ct, nonce.length);
  return combined;
}

async function decryptText(derivedKey: Uint8Array, ciphertextWithNonce: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  const key    = await deriveMessageKey(derivedKey);
  const nonce  = ciphertextWithNonce.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ct     = ciphertextWithNonce.slice(sodium.crypto_secretbox_NONCEBYTES);
  const plain  = sodium.crypto_secretbox_open_easy(ct, nonce, key);
  return new TextDecoder().decode(plain);
}

/** Save a message to a conversation (encrypts text at rest). */
export async function saveMessage(
  contactPubkeyHex: string,
  derivedKey: Uint8Array,
  msg: Omit<StoredMessage, 'ciphertext' | 'sequenceNumber' | 'replyTo'> & {
    text: string;
    sequenceNumber?: number;
    replyTo?: { id: string; from: string; text: string };
  }
): Promise<void> {
  const ciphertext = await encryptText(derivedKey, msg.text);
  const replyTo = msg.replyTo
    ? { id: msg.replyTo.id, from: msg.replyTo.from, ciphertext: await encryptText(derivedKey, msg.replyTo.text) }
    : undefined;
  const db   = await openDB();
  const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex)
    ?? { contactPubkeyHex, messages: [] };
  const id = msg.id ?? generateId();
  const existing = conv.messages.findIndex(value => value.id === id);
  const sequenceNumber = existing >= 0
    ? conv.messages[existing].sequenceNumber
    : msg.sequenceNumber ?? conv.messages.reduce((highest, value) => Math.max(highest, value.sequenceNumber ?? 0), 0) + 1;
  const { text: _text, replyTo: _replyTo, ...rest } = msg;
  const fullMsg: StoredMessage = { ...rest, ciphertext, id, sequenceNumber, ...(replyTo ? { replyTo } : {}) };
  if (existing >= 0) {
    const prior = conv.messages[existing];
    if (prior.deletedAt) {
      // Re-saving (a re-send, a status change) never brings a deleted message back.
      prior.status = msg.status;
    } else {
      // State that lives beside the content survives a re-save of the content.
      if (prior.reactions && !fullMsg.reactions) fullMsg.reactions = prior.reactions;
      if (prior.unsynced && !fullMsg.unsynced) fullMsg.unsynced = prior.unsynced;
      if (prior.editedAt && !fullMsg.editedAt) fullMsg.editedAt = prior.editedAt;
      conv.messages[existing] = fullMsg;
    }
  } else conv.messages.push(fullMsg);
  await idbPut(db, STORE, conv);
  db.close();
}

/**
 * Whether a message with this id is already stored for the conversation —
 * without decrypting anything. Used to drop duplicates: a sender re-sends a
 * message under a fresh session when its acknowledgement never arrived, and
 * that must not show up twice after an app restart has cleared memory.
 */
export async function hasMessage(contactPubkeyHex: string, id: string): Promise<boolean> {
  const db   = await openDB();
  const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
  db.close();
  return !!conv?.messages.some(message => message.id === id);
}

/** Persist a delivery-state transition without re-encrypting message content. */
export async function setMessageStatus(contactPubkeyHex: string, id: string, status: MessageStatus): Promise<void> {
  const db = await openDB();
  const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
  if (conv) {
    const message = conv.messages.find(value => value.id === id);
    if (message) {
      message.status = status;
      await idbPut(db, STORE, conv);
    }
  }
  db.close();
}

/**
 * Replace a stored message's text after an edit.
 *
 * `fromMe` is the authorship the edit claims: an edit we received may only
 * touch the peer's own messages, and one we sent only ours. Returns false when
 * the target is unknown or belongs to the other side, so a peer can never
 * rewrite what we said.
 */
export async function editStoredMessage(
  contactPubkeyHex: string,
  derivedKey: Uint8Array,
  id: string,
  text: string,
  editedAt: number,
  fromMe: boolean,
  opId?: string,
): Promise<boolean> {
  const ciphertext = await encryptText(derivedKey, text);
  const db = await openDB();
  try {
    const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
    const message = conv?.messages.find(value => value.id === id);
    if (!conv || !message || message.fromMe !== fromMe || message.deletedAt) return false;
    // Edits can arrive out of order after a retry; the newest one wins.
    if (message.editedAt && message.editedAt > editedAt) return false;
    message.ciphertext = ciphertext;
    message.editedAt = editedAt;
    if (opId) message.unsynced = { ...message.unsynced, edit: opId };
    await idbPut(db, STORE, conv);
    return true;
  } finally {
    db.close();
  }
}

/**
 * Set (emoji) or clear ('') one side's reaction to a message. `who` is 'me' for
 * our own reaction, 'them' for the peer's. Returns false for an unknown or
 * deleted message. `opId` marks our change as not yet acknowledged.
 */
export async function setStoredReaction(
  contactPubkeyHex: string,
  derivedKey: Uint8Array,
  id: string,
  who: 'me' | 'them',
  emoji: string,
  opId?: string,
): Promise<boolean> {
  const db = await openDB();
  try {
    const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
    const message = conv?.messages.find(value => value.id === id);
    if (!conv || !message || message.deletedAt) return false;
    const current = message.reactions ? await decryptReactions(derivedKey, message.reactions) : {};
    if (emoji) current[who] = emoji; else delete current[who];
    if (Object.keys(current).length) message.reactions = await encryptText(derivedKey, JSON.stringify(current));
    else delete message.reactions;
    if (opId) message.unsynced = { ...message.unsynced, react: opId };
    await idbPut(db, STORE, conv);
    return true;
  } finally {
    db.close();
  }
}

async function decryptReactions(derivedKey: Uint8Array, ciphertext: Uint8Array): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await decryptText(derivedKey, ciphertext)) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [who, emoji] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof emoji === 'string' && emoji) out[who] = emoji;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Delete a message for everyone: its text, quote, reactions and attachment are
 * dropped and only a tombstone stays, so the conversation still shows that
 * something was deleted. Quotes of it in later replies are scrubbed too.
 *
 * `fromMe` is the authorship the deletion claims (as for edits): a peer can
 * only delete their own messages. Returns the removed attachment's file id so
 * the caller can drop the stored file, `ok: false` when refused.
 */
export async function deleteStoredMessage(
  contactPubkeyHex: string,
  derivedKey: Uint8Array,
  id: string,
  fromMe: boolean,
  deletedAt: number,
  opId?: string,
): Promise<{ ok: boolean; fileId?: string }> {
  const empty = await encryptText(derivedKey, '');
  const db = await openDB();
  try {
    const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
    const message = conv?.messages.find(value => value.id === id);
    if (!conv || !message || message.fromMe !== fromMe) return { ok: false };
    const fileId = message.attachment?.fileId;
    if (!message.deletedAt) {
      message.ciphertext = empty;
      message.deletedAt = deletedAt;
      delete message.replyTo;
      delete message.attachment;
      delete message.reactions;
      delete message.editedAt;
    }
    // The deletion supersedes any edit or reaction still waiting to be sent.
    if (opId) message.unsynced = { del: opId };
    for (const other of conv.messages) {
      if (other.replyTo?.id === id) other.replyTo = { id, from: other.replyTo.from, ciphertext: empty };
    }
    await idbPut(db, STORE, conv);
    return { ok: true, fileId };
  } finally {
    db.close();
  }
}

/** Remove one message from this device only ("delete for me"). */
export async function removeStoredMessage(contactPubkeyHex: string, id: string): Promise<{ ok: boolean; fileId?: string }> {
  const db = await openDB();
  try {
    const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
    const index = conv?.messages.findIndex(value => value.id === id) ?? -1;
    if (!conv || index < 0) return { ok: false };
    const [removed] = conv.messages.splice(index, 1);
    await idbPut(db, STORE, conv);
    return { ok: true, fileId: removed.attachment?.fileId };
  } finally {
    db.close();
  }
}

/**
 * The peer acknowledged control message `opId`: the change it carried is now
 * in sync. Returns the id of the message it was about, or null.
 */
export async function markOpSynced(contactPubkeyHex: string, opId: string): Promise<string | null> {
  const db = await openDB();
  try {
    const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
    if (!conv) return null;
    for (const message of conv.messages) {
      if (!message.unsynced) continue;
      const kind = (Object.keys(message.unsynced) as SyncKind[]).find(k => message.unsynced![k] === opId);
      if (!kind) continue;
      delete message.unsynced[kind];
      if (!Object.keys(message.unsynced).length) delete message.unsynced;
      await idbPut(db, STORE, conv);
      return message.id;
    }
    return null;
  } finally {
    db.close();
  }
}

/** Load and decrypt a full conversation. */
export async function getConversation(
  contactPubkeyHex: string,
  derivedKey: Uint8Array
): Promise<Conversation | null> {
  const db   = await openDB();
  const conv = await idbGet<ConversationHeader>(db, STORE, contactPubkeyHex);
  db.close();
  if (!conv) return null;

  const messages = await Promise.all([...conv.messages]
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0) || a.timestamp - b.timestamp)
    .map(async (m) => ({
    ...m,
    text: await decryptText(derivedKey, m.ciphertext),
    replyTo: m.replyTo
      ? { id: m.replyTo.id, from: m.replyTo.from, text: await decryptText(derivedKey, m.replyTo.ciphertext) }
      : undefined,
    reactions: m.reactions ? await decryptReactions(derivedKey, m.reactions) : undefined,
  })));

  return { contactPubkeyHex: conv.contactPubkeyHex, messages };
}

/**
 * Get all conversation headers WITHOUT decrypting message content.
 * Use getConversation() to decrypt individual conversations.
 */
export async function getAllConversationHeaders(): Promise<ConversationHeader[]> {
  const db      = await openDB();
  const headers = await idbGetAll<ConversationHeader>(db, STORE);
  db.close();
  return headers;
}

/**
 * @deprecated Use getAllConversationHeaders(). This alias exists for backwards
 * compatibility with existing callers — it returns encrypted ciphertext, not plaintext.
 */
export const getAllConversations = getAllConversationHeaders;

/** Delete an entire conversation. */
export async function deleteConversation(contactPubkeyHex: string): Promise<void> {
  const db = await openDB();
  await idbDelete(db, STORE, contactPubkeyHex);
  db.close();
}

// ── Persistent unread counts ────────────────────────────────────────────────────────────────

const UNREAD_STORE = 'unread';

interface UnreadEntry {
  contactPubkeyHex: string;
  count: number;
}

/** Increment the unread count for a contact by 1. */
export async function incrementUnread(contactPubkeyHex: string): Promise<void> {
  const db    = await openDB();
  const entry = await idbGet<UnreadEntry>(db, UNREAD_STORE, contactPubkeyHex);
  await idbPut(db, UNREAD_STORE, { contactPubkeyHex, count: (entry?.count ?? 0) + 1 });
  db.close();
}

/** Clear the unread count for a contact (called on conversation open). */
export async function clearUnread(contactPubkeyHex: string): Promise<void> {
  const db = await openDB();
  await idbDelete(db, UNREAD_STORE, contactPubkeyHex);
  db.close();
}

/** Load all persisted unread counts as a Map. Called on unlock. */
export async function getAllUnread(): Promise<Map<string, number>> {
  const db      = await openDB();
  const entries = await idbGetAll<UnreadEntry>(db, UNREAD_STORE);
  db.close();
  return new Map(entries.map(e => [e.contactPubkeyHex, e.count]));
}
