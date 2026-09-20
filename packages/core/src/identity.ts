/**
 * Kant Identity — keypair generation, Argon2id password derivation, IndexedDB storage
 */

import { getSodium } from './sodium.js';
import { openDB, idbGet, idbPut, idbClear } from './db.js';

const STORE = 'identity';
const KEY   = 'keypair';

export interface StoredKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
}

/** Returned by unlockIdentity — includes the Argon2id-derived key for at-rest encryption. */
export interface UnlockedIdentity extends StoredKeypair {
  /** 32-byte Argon2id-derived key. Use this (not the raw seed) for at-rest encryption. */
  derivedKey: Uint8Array;
}

interface EncryptedKeypair {
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  await sodium.ready;
  return sodium.crypto_pwhash(
    32,
    sodium.from_string(password),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
}

export async function hasIdentity(): Promise<boolean> {
  const db     = await openDB();
  const stored = await idbGet<EncryptedKeypair>(db, STORE, KEY);
  db.close();
  return stored !== undefined;
}

export async function createIdentity(password: string): Promise<UnlockedIdentity> {
  const sodium = await getSodium();
  const kp     = sodium.crypto_sign_keypair();
  const salt   = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const encKey = await deriveKey(password, salt);
  const nonce  = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(kp.privateKey, nonce, encKey);

  const stored: EncryptedKeypair = {
    salt,
    nonce,
    ciphertext,
    publicKey:    kp.publicKey,
    publicKeyHex: sodium.to_hex(kp.publicKey),
  };

  const db = await openDB();
  await idbPut(db, STORE, stored, KEY);
  db.close();

  return {
    publicKey:    kp.publicKey,
    privateKey:   kp.privateKey,
    publicKeyHex: stored.publicKeyHex,
    derivedKey:   encKey,
  };
}

export async function unlockIdentity(password: string): Promise<UnlockedIdentity | null> {
  const sodium = await getSodium();
  const db     = await openDB();
  const stored = await idbGet<EncryptedKeypair>(db, STORE, KEY);
  db.close();

  if (!stored) return null;

  const encKey = await deriveKey(password, stored.salt);
  try {
    const privateKey = sodium.crypto_secretbox_open_easy(stored.ciphertext, stored.nonce, encKey);
    return {
      publicKey:    stored.publicKey,
      privateKey,
      publicKeyHex: stored.publicKeyHex,
      derivedKey:   encKey,
    };
  } catch {
    return null;
  }
}

export async function wipeIdentity(): Promise<void> {
  const db     = await openDB();
  const stores = ['identity', 'contacts', 'messages', 'prekeys', 'queue', 'groups', 'groupmsgs', 'files', 'unread'];
  await Promise.all(stores.map(s => idbClear(db, s)));
  db.close();
}
