/**
 * Kant Contacts — IndexedDB storage for contacts with QR code sharing
 */
import sodium from 'libsodium-wrappers-sumo';
import QRCode from 'qrcode';
const DB_NAME = 'kant';
const STORE = 'contacts';
async function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
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
/** Add or update a contact */
export async function addContact(publicKeyHex, nickname) {
    await sodium.ready;
    // Validate it's already a hex string (64 hex chars = 32-byte Ed25519 pubkey)
    if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex))
        throw new Error('Invalid public key hex');
    const db = await openDB();
    await dbPut(db, { publicKeyHex, nickname, addedAt: Date.now() });
    db.close();
}
/** Get all contacts */
export async function getContacts() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
/** Get single contact by hex */
export async function getContact(publicKeyHex) {
    const db = await openDB();
    const contact = await dbGet(db, publicKeyHex);
    db.close();
    return contact;
}
/** Delete contact */
export async function deleteContact(publicKeyHex) {
    const db = await openDB();
    await dbDelete(db, publicKeyHex);
    db.close();
}
/** Generate QR code SVG for sharing (format: hex|nickname) */
export async function generateQR(publicKeyHex, nickname) {
    const data = nickname ? `${publicKeyHex}|${nickname}` : publicKeyHex;
    return QRCode.toString(data, { type: 'svg', width: 256 });
}
/** Parse QR code data */
export function parseQR(qrData) {
    const parts = qrData.split('|', 2);
    if (parts.length === 0 || parts[0].length !== 64)
        return null;
    return {
        publicKeyHex: parts[0],
        nickname: parts[1] || undefined
    };
}
