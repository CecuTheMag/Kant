/**
 * Kant Identity — keypair generation, Argon2id password derivation, IndexedDB storage
 */
import sodium from 'libsodium-wrappers';
const DB_NAME = 'kant';
const DB_VERSION = 1;
const STORE = 'identity';
const KEY = 'keypair';
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function dbGet(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function dbPut(db, key, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
function dbDelete(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
/** Derive a 32-byte key from password using Argon2id */
async function deriveKey(password, salt) {
    await sodium.ready;
    return sodium.crypto_pwhash(32, password, salt, sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_ALG_ARGON2ID13);
}
/** Check if a keypair exists in IndexedDB */
export async function hasIdentity() {
    const db = await openDB();
    const stored = await dbGet(db, KEY);
    db.close();
    return stored !== undefined;
}
/**
 * Create a new Ed25519 keypair, encrypt the private key with Argon2id(password),
 * and store in IndexedDB. Throws if identity already exists.
 */
export async function createIdentity(password) {
    await sodium.ready;
    const kp = sodium.crypto_sign_keypair();
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const encKey = await deriveKey(password, salt);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(kp.privateKey, nonce, encKey);
    const stored = {
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
/**
 * Unlock the stored keypair with the given password.
 * Returns null if password is wrong.
 */
export async function unlockIdentity(password) {
    await sodium.ready;
    const db = await openDB();
    const stored = await dbGet(db, KEY);
    db.close();
    if (!stored)
        return null;
    const encKey = await deriveKey(password, stored.salt);
    try {
        const privateKey = sodium.crypto_secretbox_open_easy(stored.ciphertext, stored.nonce, encKey);
        return { publicKey: stored.publicKey, privateKey, publicKeyHex: stored.publicKeyHex };
    }
    catch {
        return null; // wrong password
    }
}
/** Wipe all identity data from IndexedDB */
export async function wipeIdentity() {
    const db = await openDB();
    await dbDelete(db, KEY);
    db.close();
}
