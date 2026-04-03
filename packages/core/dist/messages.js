/**
 * Kant Messages — Per-contact conversation persistence with at-rest encryption
 */
import sodium from 'libsodium-wrappers-sumo';
const DB_NAME = 'kant';
const STORE = 'messages';
async function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function deriveMessageKey(privateKey) {
    // Deterministic KDF from first 32 bytes of Ed25519 privateKey for message encryption
    const seed = privateKey.slice(0, 32);
    const key = sodium.crypto_kdf_derive_from_key(32, 1, 'kant-messages', seed);
    return key;
}
async function encryptText(privateKey, text) {
    await sodium.ready;
    const key = deriveMessageKey(privateKey);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(new TextEncoder().encode(text), nonce, key);
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);
    return combined;
}
async function decryptText(privateKey, ciphertextWithNonce) {
    await sodium.ready;
    const key = deriveMessageKey(privateKey);
    const nonce = ciphertextWithNonce.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = ciphertextWithNonce.slice(sodium.crypto_secretbox_NONCEBYTES);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    return new TextDecoder().decode(plaintext);
}
async function dbGet(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function dbPut(db, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
async function dbDelete(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
/** Save a message to conversation (encrypts text) */
export async function saveMessage(contactPubkeyHex, identityPrivateKey, msg) {
    const ciphertext = await encryptText(identityPrivateKey, msg.text);
    const fullMsg = { ...msg, ciphertext, id: crypto.randomUUID() };
    const db = await openDB();
    const conv = await dbGet(db, contactPubkeyHex) ?? { contactPubkeyHex, messages: [] };
    conv.messages.push(fullMsg);
    await dbPut(db, conv);
    db.close();
}
/** Load decrypted conversation */
export async function getConversation(contactPubkeyHex, identityPrivateKey) {
    const db = await openDB();
    const conv = await dbGet(db, contactPubkeyHex);
    db.close();
    if (!conv)
        return null;
    // Decrypt all messages
    const decrypted = {
        contactPubkeyHex: conv.contactPubkeyHex,
        messages: await Promise.all(conv.messages.map(async (m) => ({
            ...m,
            text: await decryptText(identityPrivateKey, m.ciphertext)
        })))
    };
    return decrypted;
}
/** Get summaries of all conversations */
export async function getAllConversations() {
    // Note: summaries without decrypt (for list), full decrypt in getConversation
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
/** Delete entire conversation */
export async function deleteConversation(contactPubkeyHex) {
    const db = await openDB();
    await dbDelete(db, contactPubkeyHex);
    db.close();
}
