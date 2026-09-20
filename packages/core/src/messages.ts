/**
 * Kant Messages — Per-contact conversation persistence with at-rest encryption.
 *
 * At-rest key: derived from the Argon2id key (the same key that unlocks the
 * identity), NOT from the raw Ed25519 seed. This keeps the password in the
 * decryption chain — a seized IDB without the password cannot decrypt messages.
 */

import { getSodium } from './sodium.js';
import { openDB, idbGet, idbPut, idbDelete, idbGetAll } from './db.js';

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
}

export interface ConversationHeader {
  contactPubkeyHex: string;
  /** Messages are stored encrypted — use getConversation() to decrypt. */
  messages: StoredMessage[];
}

/** @deprecated Use ConversationHeader. Kept for type compatibility. */
export type Conversation = Omit<ConversationHeader, 'messages'> & {
  messages: (Omit<StoredMessage, 'replyTo'> & { text?: string; replyTo?: { id: string; from: string; text: string } })[];
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
  if (existing >= 0) conv.messages[existing] = fullMsg;
  else conv.messages.push(fullMsg);
  await idbPut(db, STORE, conv);
  db.close();
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
