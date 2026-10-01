/**
 * Kant Contacts — IndexedDB storage for contacts with QR code sharing
 */

import QRCode from 'qrcode';
import { openDB, idbGet as dbGetContact, idbPut as dbPutContact, idbDelete as dbDeleteContact, idbGetAll as dbGetAllContacts } from './db.js';
import { addrReaches, contactRelayUrl } from './reach.js';

export interface Contact {
  /** Stable contact id — NEVER changes. Defaults to publicKeyHex for legacy records.
   *  The id is what threads/unread/trust hang off; the key is mutable (can rotate). */
  id?: string;
  publicKeyHex: string;
  nickname?: string;
  addedAt: number;
  /** Last circuit address that names this contact's PeerID (see reach.ts).
   *  Kept across failed dials: a contact who is merely offline comes back here. */
  lastCircuitAddr?: string;
  /** HTTP base URL of the relay the contact said they use (invite link or
   *  presence), so they can be looked up there when our relay doesn't know them. */
  relayUrl?: string;
  lastSeen?: number;         // Unix ms of last presence
  /** Trust state for the identity-verification UI (design pass 2026-08-17).
   *  unverified = default; verified = completed ceremony only; changed = observed key rotation. */
  trust?: 'unverified' | 'verified' | 'changed';
  /** When trust === 'changed', the identity key we knew before. */
  previousKeyHex?: string;
  /** When the ceremony was completed (Unix ms), so the UI can date it. */
  verifiedAt?: number;
  /** Created by an inbound message from someone we never added. The UI shows
   *  these as message requests until the user accepts or blocks them. */
  request?: boolean;
  /** Messages from blocked contacts are dropped on arrival. */
  blocked?: boolean;
  /** Protocol capabilities the peer has advertised (see envelope.ts). Absent = legacy client. */
  caps?: string[];
}

/** Normalize a stored record: backfill id + trust for legacy rows (no backfill to verified). */
export function normalizeContact(c: Contact): Contact {
  return {
    ...c,
    id: c.id ?? c.publicKeyHex,
    trust: c.trust ?? 'unverified',
  };
}

/** Persist trust state for a contact. */
export async function setContactTrust(publicKeyHex: string, trust: Contact['trust'], previousKeyHex?: string): Promise<void> {
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  if (!existing) { db.close(); return; }
  await dbPutContact(db, STORE, {
    ...existing,
    trust,
    previousKeyHex: previousKeyHex ?? existing.previousKeyHex,
    verifiedAt: trust === 'verified' ? Date.now() : existing.verifiedAt,
  });
  db.close();
}

const STORE = 'contacts';

/** Add or update a contact.
 *  `flags` sets the request/blocked state; omitted flags keep their stored value.
 *  `flags.relayUrl` records the relay their invite named. A circuit address or
 *  relay URL that can't belong to this contact is ignored. */
export async function addContact(
  publicKeyHex: string,
  nickname?: string,
  circuitAddr?: string,
  flags?: { request?: boolean; blocked?: boolean; relayUrl?: string },
): Promise<void> {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) throw new Error('Invalid public key hex');
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  await dbPutContact(db, STORE, {
    ...existing,
    publicKeyHex,
    nickname:       nickname ?? existing?.nickname,
    addedAt:        existing?.addedAt ?? Date.now(),
    lastCircuitAddr: addrReaches(circuitAddr, publicKeyHex) ? circuitAddr : existing?.lastCircuitAddr,
    relayUrl:       contactRelayUrl(flags?.relayUrl) ?? existing?.relayUrl,
    request:        flags?.request ?? existing?.request,
    blocked:        flags?.blocked ?? existing?.blocked,
  });
  db.close();
}

/**
 * Persist a fresh circuit address for a contact. Only an address that names
 * the contact's own PeerID is stored, and a failed dial never clears it: the
 * last good address is how we find someone who was merely offline. Returns
 * true when the address was accepted.
 */
export async function updateContactAddr(publicKeyHex: string, circuitAddr: string): Promise<boolean> {
  if (!addrReaches(circuitAddr, publicKeyHex)) return false;
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  if (!existing) { db.close(); return false; }
  await dbPutContact(db, STORE, { ...existing, lastCircuitAddr: circuitAddr, lastSeen: Date.now() });
  db.close();
  return true;
}

/** Record the relay a contact told us they use. Returns true when it changed. */
export async function setContactRelay(publicKeyHex: string, relayUrl: string): Promise<boolean> {
  const url = contactRelayUrl(relayUrl);
  if (!url) return false;
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  if (!existing || existing.relayUrl === url) { db.close(); return false; }
  await dbPutContact(db, STORE, { ...existing, relayUrl: url });
  db.close();
  return true;
}

/**
 * Drop a stored address that provably isn't the contact's (it names another
 * PeerID — written by an old build). A merely unreachable address is kept.
 */
export async function dropForeignContactAddr(publicKeyHex: string): Promise<boolean> {
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  if (!existing?.lastCircuitAddr || addrReaches(existing.lastCircuitAddr, publicKeyHex)) { db.close(); return false; }
  await dbPutContact(db, STORE, { ...existing, lastCircuitAddr: undefined });
  db.close();
  return true;
}

/**
 * Record the capabilities a contact advertised. Only ever widens the set: a
 * peer is not downgraded by a presence ping that omits caps (an old build
 * running on another of their devices, or a stripped ping), because the only
 * consequence of a stale "supported" is that they see a reply envelope as JSON.
 * Returns true when the stored record changed.
 */
export async function addContactCaps(publicKeyHex: string, caps: string[]): Promise<boolean> {
  if (!caps.length) return false;
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  const known    = existing?.caps ?? [];
  const merged   = [...known, ...caps.filter(cap => !known.includes(cap))].slice(0, 32);
  if (!existing || merged.length === known.length) { db.close(); return false; }
  await dbPutContact(db, STORE, { ...existing, caps: merged });
  db.close();
  return true;
}

/** Get all contacts (normalized: id + trust backfilled for legacy rows) */
export async function getContacts(): Promise<Contact[]> {
  const db       = await openDB();
  const contacts = await dbGetAllContacts<Contact>(db, STORE);
  db.close();
  return contacts.map(normalizeContact);
}

/** Get single contact by hex */
export async function getContact(publicKeyHex: string): Promise<Contact | undefined> {
  const db      = await openDB();
  const contact = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  db.close();
  return contact;
}

/** Delete contact */
export async function deleteContact(publicKeyHex: string): Promise<void> {
  const db = await openDB();
  await dbDeleteContact(db, STORE, publicKeyHex);
  db.close();
}

/** Generate QR code SVG for sharing (format: hex|nickname) */
export async function generateQR(publicKeyHex: string, nickname?: string): Promise<string> {
  const data = nickname ? `${publicKeyHex}|${nickname}` : publicKeyHex;
  return QRCode.toString(data, { type: 'svg', width: 256 });
}

/** Parse QR code data */
export function parseQR(qrData: string): { publicKeyHex: string; nickname?: string } | null {
  const parts = qrData.split('|', 2);
  if (parts.length === 0 || parts[0].length !== 64) return null;
  return {
    publicKeyHex: parts[0],
    nickname: parts[1] || undefined
  };
}

