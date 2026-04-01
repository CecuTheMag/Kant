/**
 * Kant Identity — keypair generation, Argon2id password derivation, IndexedDB storage
 */

import sodium from 'libsodium-wrappers';

const DB_NAME = 'kant';
const DB_VERSION = 2;
const STORE = 'identity';
const KEY = 'keypair';

export interface StoredKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
}

interface EncryptedKeypair {
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (_e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('contacts')) {
        db.createObjectStore('contacts', { keyPath: 'publicKeyHex' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'publicKeyHex' });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(db: IDBDatabase, key: string): Promise<EncryptedKeypair | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(db: IDBDatabase, key: string, value: EncryptedKeypair): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_pwhash(
    32,
    sodium.from_string(password),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
}

export async function hasIdentity(): Promise<boolean> {
  const db = await openDB();
  const stored = await dbGet(db, KEY);
  db.close();
  return stored !== undefined;
}

export async function createIdentity(password: string): Promise<StoredKeypair> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const encKey = await deriveKey(password, salt);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(kp.privateKey, nonce, encKey);

  const stored: EncryptedKeypair = {
    salt,
    nonce,
    ciphertext,
    publicKey: kp.publicKey,
    publicKeyHex: sodium.to_hex(kp.publicKey)
  };

  const db = await openDB();
  await dbPut(db, KEY, stored);
  db.close();

  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyHex: stored.publicKeyHex };
}

export async function unlockIdentity(password: string): Promise<StoredKeypair | null> {
  await sodium.ready;
  const db = await openDB();
  const stored = await dbGet(db, KEY);
  db.close();

  if (!stored) return null;

  const encKey = await deriveKey(password, stored.salt);
  try {
    const privateKey = sodium.crypto_secretbox_open_easy(stored.ciphertext, stored.nonce, encKey);
    return { publicKey: stored.publicKey, privateKey, publicKeyHex: stored.publicKeyHex };
  } catch {
    return null;
  }
}

export async function wipeIdentity(): Promise<void> {
  const db = await openDB();
  await dbDelete(db, KEY);
  db.close();
}

