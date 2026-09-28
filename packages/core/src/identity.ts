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
  /**
   * Duress password check: Argon2id(duress password, salt). When no duress
   * password is set this holds random bytes of the same shape, so the stored
   * record never reveals whether one exists. Every unlock evaluates it.
   */
  duress?: { salt: Uint8Array; verifier: Uint8Array };
  /** Whether a duress password is set, encrypted under the unlocked key (for Settings only). */
  duressMark?: { nonce: Uint8Array; ciphertext: Uint8Array };
}

/** Outcome of a password unlock. `duress`: the duress password was entered. */
export type UnlockResult =
  | { kind: 'ok'; identity: UnlockedIdentity }
  | { kind: 'duress' }
  | { kind: 'wrong' };

/**
 * The duress check uses Argon2id's interactive profile: every unlock runs it
 * in addition to the main derivation, so it must stay quick on a phone.
 */
async function duressHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_pwhash(
    32,
    sodium.from_string(password),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

async function randomDuressRecord(): Promise<{ salt: Uint8Array; verifier: Uint8Array }> {
  const sodium = await getSodium();
  return { salt: sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES), verifier: sodium.randombytes_buf(32) };
}

async function duressMarkKey(derivedKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_kdf_derive_from_key(32, 3, 'kantdurs', derivedKey);
}

async function sealDuressMark(derivedKey: Uint8Array, set: boolean): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  return { nonce, ciphertext: sodium.crypto_secretbox_easy(new Uint8Array([set ? 1 : 0]), nonce, await duressMarkKey(derivedKey)) };
}

async function readStored(): Promise<EncryptedKeypair | undefined> {
  const db = await openDB();
  try { return await idbGet<EncryptedKeypair>(db, STORE, KEY); } finally { db.close(); }
}

async function writeStored(stored: EncryptedKeypair): Promise<void> {
  const db = await openDB();
  try { await idbPut(db, STORE, stored, KEY); } finally { db.close(); }
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
    duress:       await randomDuressRecord(),
    duressMark:   await sealDuressMark(encKey, false),
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

/**
 * Unlock with a password, telling a wrong password apart from the duress
 * password. Both Argon2id checks always run, in the same order, whatever the
 * outcome — so neither the result nor the time taken shows whether a duress
 * password exists. A record from before duress support gets its filler here.
 */
export async function unlockIdentityChecked(password: string): Promise<UnlockResult> {
  const sodium = await getSodium();
  const stored = await readStored();
  if (!stored) return { kind: 'wrong' };
  const duress = stored.duress ?? await randomDuressRecord();

  const encKey = await deriveKey(password, stored.salt);
  const duressCandidate = await duressHash(password, duress.salt);

  let privateKey: Uint8Array | null = null;
  try { privateKey = sodium.crypto_secretbox_open_easy(stored.ciphertext, stored.nonce, encKey); } catch { /* not the password */ }
  if (privateKey) {
    if (!stored.duress || !stored.duressMark) {
      await writeStored({ ...stored, duress, duressMark: stored.duressMark ?? await sealDuressMark(encKey, false) });
    }
    return { kind: 'ok', identity: { publicKey: stored.publicKey, privateKey, publicKeyHex: stored.publicKeyHex, derivedKey: encKey } };
  }
  if (sodium.memcmp(duressCandidate, duress.verifier)) return { kind: 'duress' };
  return { kind: 'wrong' };
}

/**
 * Unlock with the Argon2id-derived key itself, released by the platform's
 * biometric keystore (see the app's lib/biometric.ts). Null if it doesn't fit.
 */
export async function unlockIdentityWithKey(derivedKey: Uint8Array): Promise<UnlockedIdentity | null> {
  const sodium = await getSodium();
  const stored = await readStored();
  if (!stored || derivedKey.length !== 32) return null;
  try {
    const privateKey = sodium.crypto_secretbox_open_easy(stored.ciphertext, stored.nonce, derivedKey);
    return { publicKey: stored.publicKey, privateKey, publicKeyHex: stored.publicKeyHex, derivedKey };
  } catch {
    return null;
  }
}

/**
 * Set (or with null, remove) the duress password. Entering it on the unlock
 * screen erases this identity and opens a new, empty one. Needs the unlocked
 * identity, and refuses the real password (`SAME_AS_PASSWORD`).
 */
export async function setDuressPassword(identity: UnlockedIdentity, password: string | null): Promise<void> {
  const sodium = await getSodium();
  const stored = await readStored();
  if (!stored || stored.publicKeyHex !== identity.publicKeyHex) throw new Error('NO_IDENTITY');
  // Only whoever knows the real password gets here: the mark must open.
  const mark = stored.duressMark;
  if (mark) {
    try { sodium.crypto_secretbox_open_easy(mark.ciphertext, mark.nonce, await duressMarkKey(identity.derivedKey)); }
    catch { throw new Error('NO_IDENTITY'); }
  }
  let duress = await randomDuressRecord();
  if (password !== null) {
    if (!password) throw new Error('EMPTY');
    let same = false;
    try { sodium.crypto_secretbox_open_easy(stored.ciphertext, stored.nonce, await deriveKey(password, stored.salt)); same = true; } catch { /* different — good */ }
    if (same) throw new Error('SAME_AS_PASSWORD');
    duress = { salt: duress.salt, verifier: await duressHash(password, duress.salt) };
  }
  await writeStored({ ...stored, duress, duressMark: await sealDuressMark(identity.derivedKey, password !== null) });
}

/** Whether a duress password is set (readable only while unlocked). */
export async function isDuressPasswordSet(identity: UnlockedIdentity): Promise<boolean> {
  const sodium = await getSodium();
  const stored = await readStored();
  if (!stored?.duressMark) return false;
  try {
    const plain = sodium.crypto_secretbox_open_easy(stored.duressMark.ciphertext, stored.duressMark.nonce, await duressMarkKey(identity.derivedKey));
    return plain[0] === 1;
  } catch {
    return false;
  }
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

/**
 * Erase every object store in the Kant database. The list is read from the
 * database itself rather than hard-coded, so a store added later (as `ratchets`
 * and `delivery_queue` were) can never be silently left behind by a wipe.
 */
export async function wipeIdentity(): Promise<void> {
  const db = await openDB();
  try {
    await Promise.all(Array.from(db.objectStoreNames).map(s => idbClear(db, s)));
  } finally {
    db.close();
  }
}
