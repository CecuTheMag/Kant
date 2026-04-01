/**
 * Kant Contacts — IndexedDB storage for contacts with QR code sharing
 */

import sodium from 'libsodium-wrappers';
import QRCode from 'qrcode';

const DB_NAME = 'kant';
const STORE = 'contacts';

export interface Contact {
  publicKeyHex: string;
  nickname?: string;
  addedAt: number;
}

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(db: IDBDatabase, key: string): Promise<Contact | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(db: IDBDatabase, value: Contact): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Add or update a contact */
export async function addContact(publicKeyHex: string, nickname?: string): Promise<void> {
  await sodium.ready;
  const db = await openDB();
  await dbPut(db, {
    publicKeyHex: sodium.to_hex(publicKeyHex), // ensure hex
    nickname,
    addedAt: Date.now()
  });
  db.close();
}

/** Get all contacts */
export async function getContacts(): Promise<Contact[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get single contact by hex */
export async function getContact(publicKeyHex: string): Promise<Contact | undefined> {
  const db = await openDB();
  const contact = await dbGet(db, publicKeyHex);
  db.close();
  return contact;
}

/** Delete contact */
export async function deleteContact(publicKeyHex: string): Promise<void> {
  const db = await openDB();
  await dbDelete(db, publicKeyHex);
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

