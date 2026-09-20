/**
 * Kant DB — single shared IndexedDB open/upgrade function.
 * All modules must import from here so schema changes only need one edit.
 */

export const DB_NAME = 'kant';
export const DB_VERSION = 10;

export const STORES = {
  identity:  { name: 'identity',  options: undefined },
  contacts:  { name: 'contacts',  options: { keyPath: 'publicKeyHex' } },
  messages:  { name: 'messages',  options: { keyPath: 'contactPubkeyHex' } },
  prekeys:   { name: 'prekeys',   options: undefined },
  queue:     { name: 'queue',     options: { keyPath: 'id' } },
  groups:    { name: 'groups',    options: { keyPath: 'id' } },
  groupmsgs: { name: 'groupmsgs', options: { keyPath: 'publicKeyHex' } },
  files:     { name: 'files',     options: { keyPath: 'fileId' } },
  unread:    { name: 'unread',    options: { keyPath: 'contactPubkeyHex' } },
  delivery_queue: { name: 'delivery_queue', options: { keyPath: 'id', autoIncrement: true } },
  ratchets:  { name: 'ratchets',  options: { keyPath: 'contactPubkeyHex' } },
} as const;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const oldVersion = e.oldVersion ?? 0;
      for (const { name, options } of Object.values(STORES)) {
        if (oldVersion < 7 && name === 'messages' && db.objectStoreNames.contains(name)) {
          db.deleteObjectStore(name);
        }
        if (!db.objectStoreNames.contains(name)) {
          options ? db.createObjectStore(name, options) : db.createObjectStore(name);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  });
}

export function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = key !== undefined
      ? tx.objectStore(store).put(value, key)
      : tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(req.error);
  });
}

export function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
