/**
 * Kant Queue — Offline message queue with retry on peer:connect
 */
const DB_NAME = 'kant';
const DB_VERSION = 2;
const STORE = 'queue';
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('identity'))
                db.createObjectStore('identity');
            if (!db.objectStoreNames.contains('contacts'))
                db.createObjectStore('contacts', { keyPath: 'publicKeyHex' });
            if (!db.objectStoreNames.contains('messages'))
                db.createObjectStore('messages', { keyPath: 'publicKeyHex' });
            if (!db.objectStoreNames.contains('prekeys'))
                db.createObjectStore('prekeys');
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
export async function enqueue(msg) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put({ ...msg, retries: 0 });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
    db.close();
}
export async function dequeue(id) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
    db.close();
}
export async function getPendingForContact(contactPubkeyHex) {
    const db = await openDB();
    const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return all.filter(m => m.contactPubkeyHex === contactPubkeyHex);
}
/**
 * Listen for peer:connect events and flush queued messages for that peer.
 * Returns cleanup function.
 */
export function startQueueRetry(node, 
// Map from peerId → contactPubkeyHex (maintained by App)
peerToContact, send, onDelivered) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function handleConnect(event) {
        const peerId = event.detail?.toString() ?? '';
        const contactHex = peerToContact.get(peerId);
        if (!contactHex)
            return;
        const pending = await getPendingForContact(contactHex);
        for (const msg of pending) {
            try {
                await send(msg.wirePayload, msg.peerCircuitAddr);
                await dequeue(msg.id);
                onDelivered(msg.id);
                console.log('[queue] flushed queued msg', msg.id.slice(0, 8));
            }
            catch (e) {
                console.warn('[queue] retry failed for', msg.id.slice(0, 8), e);
            }
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.addEventListener('peer:connect', handleConnect);
    return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        node.removeEventListener('peer:connect', handleConnect);
    };
}
