/**
 * Persistent file-backed IndexedDB shim for Node.js
 *
 * Stores all IndexedDB data as JSON at ~/.kant/data.json.
 * Reads on startup, auto-saves on every write. Same API surface
 * as the browser IndexedDB — identity.ts, contacts.ts, etc. work unchanged.
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const DATA_FILE = process.env.KANT_DATA_FILE || join(homedir(), '.kant', 'data.json');

// ── crypto polyfill ──────────────────────────────────────────────────────────
if (!(globalThis as any).crypto) (globalThis as any).crypto = {};
if (!(globalThis as any).crypto.randomUUID) (globalThis as any).crypto.randomUUID = randomUUID;

// ── Persistent storage ──────────────────────────────────────────────────────

interface DBStore { [key: string]: any }
interface DBData { [dbName: string]: { [storeName: string]: DBStore } }

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const UINT8_MARKER = '__uint8__';

function serialize(data: DBData): string {
  return JSON.stringify(data, (_key, value) => {
    if (value instanceof Uint8Array) {
      return { [UINT8_MARKER]: Array.from(value) };
    }
    return value;
  }, 2);
}

function deserialize(raw: string): DBData {
  return JSON.parse(raw, (_key, value) => {
    if (value && typeof value === 'object' && UINT8_MARKER in value) {
      return new Uint8Array(value[UINT8_MARKER]);
    }
    return value;
  });
}

function loadData(): DBData {
  try {
    return deserialize(readFileSync(DATA_FILE, 'utf-8'));
  } catch { return {}; }
}

function saveData(data: DBData) {
  ensureDir(DATA_FILE);
  writeFileSync(DATA_FILE, serialize(data));
}

const _data: DBData = loadData();

// Auto-save on process exit
process.on('exit', () => saveData(_data));
process.on('SIGINT', () => { saveData(_data); process.exit(0); });
process.on('SIGTERM', () => { saveData(_data); process.exit(0); });

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(result: any, error?: any) {
  const req: any = { result, error, onsuccess: null, onerror: null };
  Promise.resolve().then(() => {
    if (error) req.onerror?.({ target: req });
    else       req.onsuccess?.({ target: req });
  });
  return req;
}

function getStore(dbName: string, storeName: string): DBStore {
  if (!_data[dbName]) _data[dbName] = {};
  if (!_data[dbName][storeName]) _data[dbName][storeName] = {};
  return _data[dbName][storeName];
}

function makeTransaction(dbName: string) {
  // Real IndexedDB transactions signal completion separately from each request.
  // `reserveOPK` in @kant/core resolves on `tx.oncomplete` after walking a
  // cursor, so a shim that only implements per-request callbacks leaves that
  // promise pending forever. Track outstanding cursor walks and fire the
  // transaction callbacks once they drain.
  const tx: any = { oncomplete: null, onerror: null, onabort: null, error: null };
  let pendingCursors = 0;
  let settled = false;

  function settle() {
    if (settled || pendingCursors > 0) return;
    settled = true;
    tx.oncomplete?.({ target: tx });
  }

  // Two microtask hops: lets a synchronously-opened cursor register itself
  // before we decide the transaction had no work to wait for.
  function scheduleSettle() {
    Promise.resolve().then(() => Promise.resolve().then(settle));
  }

  tx.objectStore = function objectStore(storeName: string) {
    const store = getStore(dbName, storeName);
    return {
      get(key: string) {
        return makeRequest(store[key] ?? undefined);
      },
      put(value: any, key?: string) {
        const k = key
          ?? value?.id
          ?? value?.publicKeyHex
          ?? value?.publicKey;
        if (k !== undefined) store[k] = value;
        saveData(_data);
        return makeRequest(undefined);
      },
      delete(key: string) {
        delete store[key];
        saveData(_data);
        return makeRequest(undefined);
      },
      getAll() {
        return makeRequest(Object.values(store));
      },
      clear() {
        for (const key of Object.keys(store)) delete store[key];
        saveData(_data);
        return makeRequest(undefined);
      },
      count() {
        return makeRequest(Object.keys(store).length);
      },
      openCursor() {
        const req: any = { result: null, error: null, onsuccess: null, onerror: null };
        // Snapshot the keys: the cursor's final callback writes back into the
        // same store (reserveOPK marks the chosen OPK), and iterating live keys
        // while mutating them would be undefined behaviour.
        const keys = Object.keys(store);
        let index = 0;
        pendingCursors++;

        function step() {
          if (index < keys.length) {
            const key = keys[index++];
            req.result = {
              key,
              value: store[key],
              continue: () => { Promise.resolve().then(step); },
            };
            req.onsuccess?.({ target: req });
            return;
          }
          // Exhausted: real IDB delivers one final callback with a null result,
          // and only then completes the transaction.
          req.result = null;
          pendingCursors--;
          req.onsuccess?.({ target: req });
          scheduleSettle();
        }

        Promise.resolve().then(step);
        return req;
      },
    };
  };

  scheduleSettle();
  return tx;
}

function makeDB(dbName: string): any {
  if (!_data[dbName]) _data[dbName] = {};

  const db: any = {
    objectStoreNames: {
      contains: (s: string) => s in _data[dbName],
    },
    createObjectStore(storeName: string, _opts?: any) {
      if (!_data[dbName][storeName]) _data[dbName][storeName] = {};
      saveData(_data);
      return {};
    },
    deleteObjectStore(storeName: string) {
      delete _data[dbName][storeName];
      saveData(_data);
    },
    transaction(_storeName: string | string[], _mode?: string) {
      return makeTransaction(dbName);
    },
    close() {},
  };

  return db;
}

// ── globalThis.indexedDB ─────────────────────────────────────────────────────

(globalThis as any).indexedDB = {
  open(dbName: string, _version?: number) {
    const db = makeDB(dbName);

    const req: any = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };

    Promise.resolve().then(() => {
      if (req.onupgradeneeded) {
        req.result = db;
        req.onupgradeneeded({ target: req });
      }
      req.result = db;
      req.onsuccess?.({ target: req });
    });

    return req;
  },
};
