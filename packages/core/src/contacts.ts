/**
 * Kant Contacts — IndexedDB storage for contacts with QR code sharing
 */

import QRCode from 'qrcode';
import { openDB, idbGet as dbGetContact, idbPut as dbPutContact, idbDelete as dbDeleteContact, idbGetAll as dbGetAllContacts } from './db.js';

export interface Contact {
  /** Stable contact id — NEVER changes. Defaults to publicKeyHex for legacy records.
   *  The id is what threads/unread/trust hang off; the key is mutable (can rotate). */
  id?: string;
  publicKeyHex: string;
  nickname?: string;
  addedAt: number;
  lastCircuitAddr?: string;  // persisted so we never ask again
  lastSeen?: number;         // Unix ms of last presence
  /** Trust state for the identity-verification UI (design pass 2026-08-17).
   *  unverified = default; verified = completed ceremony only; changed = observed key rotation. */
  trust?: 'unverified' | 'verified' | 'changed';
  /** When trust === 'changed', the identity key we knew before. */
  previousKeyHex?: string;
  /** When the ceremony was completed (Unix ms), so the UI can date it. */
  verifiedAt?: number;
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

/** Add or update a contact */
export async function addContact(publicKeyHex: string, nickname?: string, circuitAddr?: string): Promise<void> {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) throw new Error('Invalid public key hex');
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  await dbPutContact(db, STORE, {
    ...existing,
    publicKeyHex,
    nickname:       nickname ?? existing?.nickname,
    addedAt:        existing?.addedAt ?? Date.now(),
    lastCircuitAddr: circuitAddr ?? existing?.lastCircuitAddr,
  });
  db.close();
}

/** Persist a fresh circuit address for a contact */
export async function updateContactAddr(publicKeyHex: string, circuitAddr: string): Promise<void> {
  const db       = await openDB();
  const existing = await dbGetContact<Contact>(db, STORE, publicKeyHex);
  if (!existing) { db.close(); return; }
  await dbPutContact(db, STORE, { ...existing, lastCircuitAddr: circuitAddr, lastSeen: Date.now() });
  db.close();
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

