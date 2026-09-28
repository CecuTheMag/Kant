/**
 * Kant bundle — everything this device holds for one identity, as an
 * encrypted stream. Two uses:
 *
 *  - Backup file (createBackupFile / restoreBackupFile): encrypted with a key
 *    derived from the account password (Argon2id, fresh salt). Chat sessions
 *    and outboxes are left out: a backup restored while the original device
 *    still runs would otherwise fork every Double Ratchet session. After a
 *    restore, sessions re-establish themselves on first contact.
 *  - Device move (transfer.ts): the same stream, keyed by a one-time X25519
 *    exchange, sessions included — the old device is erased afterwards, so
 *    they move exactly once.
 *
 * The identity record inside is still encrypted with the account password;
 * the bundle adds a second layer, never removes one.
 *
 * Plaintext stream: newline-delimited JSON — a header line, one line per
 * stored record (`{ s: store, k?: key, v: value }`, byte arrays as
 * `{ $u8: base64 }`), a settings line, and an end line with the record count.
 * It is cut into fixed-size chunks and sealed with
 * crypto_secretstream_xchacha20poly1305, so truncation, reordering or
 * tampering is detected, and the end line is checked before a restore counts.
 */
import { getSodium } from './sodium.js';
import { openDB, idbClear, STORES } from './db.js';
import { deriveKey, hasIdentity, unlockIdentityChecked } from './identity.js';

export const BUNDLE_VERSION = 1;
/** Plaintext bytes per sealed chunk. */
export const BUNDLE_CHUNK = 64 * 1024;
/** A single record line may be large (a stored file), but not unbounded. */
const MAX_LINE_BYTES = 256 * 1024 * 1024;

const SESSION_STORES = new Set(['ratchets', 'queue', 'delivery_queue']);
/** One restore at a time: two would clear and fill the same database under each other. */
let restoreInProgress = false;
const STORE_NAMES = new Set<string>(Object.values(STORES).map(s => s.name));

export interface BundleOptions {
  /** Double Ratchet sessions and outboxes — only when the source device stops using them (a move). */
  includeSessions: boolean;
  /** Stored attachments (photos, voice notes, files). */
  includeFiles: boolean;
  /** Device settings to carry over (localStorage key → value). */
  settings?: Record<string, string>;
}

export interface BundleSummary { records: number; settings: Record<string, string>; publicKeyHex: string }

/* ── Serialisation ───────────────────────────────────────────────────── */

type Sodium = Awaited<ReturnType<typeof getSodium>>;

function jsonLine(sodium: Sodium, value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v instanceof Uint8Array ? { $u8: sodium.to_base64(v, sodium.base64_variants.ORIGINAL) } : v) + '\n';
}

function parseLine(sodium: Sodium, line: string): any {
  return JSON.parse(line, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$u8 === 'string' && Object.keys(v).length === 1) {
      return sodium.from_base64(v.$u8, sodium.base64_variants.ORIGINAL);
    }
    return v;
  });
}

function storeKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function storeGet(db: IDBDatabase, store: string, key: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hasKeyPath(store: string): boolean {
  const def = Object.values(STORES).find(s => s.name === store);
  return !!def?.options && 'keyPath' in def.options;
}

/** The plaintext stream, as lines. Records are read one at a time, so large files never all sit in memory. */
async function* bundleLines(options: BundleOptions): AsyncGenerator<string> {
  const sodium = await getSodium();
  const db = await openDB();
  try {
    yield jsonLine(sodium, { kant: 'bundle', v: BUNDLE_VERSION, created: Date.now(), sessions: options.includeSessions });
    let records = 0;
    for (const store of Array.from(db.objectStoreNames)) {
      if (!STORE_NAMES.has(store)) continue;
      if (!options.includeSessions && SESSION_STORES.has(store)) continue;
      if (!options.includeFiles && store === 'files') continue;
      for (const key of await storeKeys(db, store)) {
        const value = await storeGet(db, store, key);
        if (value === undefined) continue;
        yield jsonLine(sodium, hasKeyPath(store) ? { s: store, v: value } : { s: store, k: key, v: value });
        records++;
      }
    }
    yield jsonLine(sodium, { settings: options.settings ?? {} });
    yield jsonLine(sodium, { end: true, records });
  } finally {
    db.close();
  }
}

/** Lines → fixed-size byte chunks. */
async function* toChunks(lines: AsyncIterable<string>, size = BUNDLE_CHUNK): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let buf = new Uint8Array(size);
  let used = 0;
  for await (const line of lines) {
    let bytes = encoder.encode(line);
    while (bytes.length) {
      const n = Math.min(size - used, bytes.length);
      buf.set(bytes.subarray(0, n), used);
      used += n;
      bytes = bytes.subarray(n);
      if (used === size) { yield buf; buf = new Uint8Array(size); used = 0; }
    }
  }
  if (used) yield buf.slice(0, used);
}

/**
 * The sealed stream: first the secretstream header, then each chunk. The
 * last chunk carries TAG_FINAL, so a stream cut short never looks complete.
 */
export async function* sealedBundle(key: Uint8Array, options: BundleOptions): AsyncGenerator<Uint8Array> {
  const sodium = await getSodium();
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  yield header;
  let pending: Uint8Array | null = null;
  for await (const chunk of toChunks(bundleLines(options))) {
    if (pending) yield sodium.crypto_secretstream_xchacha20poly1305_push(state, pending, null, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
    pending = chunk;
  }
  yield sodium.crypto_secretstream_xchacha20poly1305_push(state, pending ?? new Uint8Array(0), null, sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
}

/* ── Restoring ───────────────────────────────────────────────────────── */

/**
 * Receives a sealed bundle chunk by chunk and writes it into an empty
 * database. Any failure — wrong key, tampering, truncation, a malformed or
 * unexpected record — erases whatever was written, so a half-restored
 * identity can never be left behind.
 */
export class BundleRestorer {
  private sodium!: Sodium;
  private state: unknown = null;
  private db: IDBDatabase | null = null;
  private decoder = new TextDecoder();
  private pending = '';
  private header: any = null;
  private records = 0;
  private settings: Record<string, string> = {};
  private publicKeyHex = '';
  private ended = false;
  private finalSeen = false;
  private failed = false;
  private holdsLock = false;

  constructor(private readonly key: Uint8Array) {}

  private release(): void {
    if (this.holdsLock) { this.holdsLock = false; restoreInProgress = false; }
  }

  /** Refuses to run over an existing identity, or beside another restore. */
  async begin(): Promise<void> {
    if (restoreInProgress) throw new Error('BUSY');
    restoreInProgress = true;
    this.holdsLock = true;
    try {
      this.sodium = await getSodium();
      if (await hasIdentity()) throw new Error('IDENTITY_EXISTS');
    } catch (error) {
      this.release();
      throw error;
    }
    this.db = await openDB();
    for (const store of Array.from(this.db.objectStoreNames)) await idbClear(this.db, store);
  }

  /** The first sealed piece: the secretstream header. */
  async start(header: Uint8Array): Promise<void> {
    try {
      this.state = this.sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, this.key);
    } catch {
      await this.abort();
      throw new Error('BAD_KEY');
    }
  }

  async push(sealed: Uint8Array): Promise<void> {
    if (this.failed) throw new Error('ABORTED');
    if (!this.state || this.finalSeen) { await this.abort(); throw new Error('UNEXPECTED_DATA'); }
    let res: { message: Uint8Array; tag: number } | false;
    try {
      res = this.sodium.crypto_secretstream_xchacha20poly1305_pull(this.state as any, sealed, null) as any;
    } catch { res = false; }
    if (!res) { await this.abort(); throw new Error('BAD_KEY'); }
    if (res.tag === this.sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) this.finalSeen = true;
    try {
      this.pending += this.decoder.decode(res.message, { stream: !this.finalSeen });
      if (this.pending.length > MAX_LINE_BYTES) throw new Error('LINE_TOO_LONG');
      let nl: number;
      while ((nl = this.pending.indexOf('\n')) >= 0) {
        const line = this.pending.slice(0, nl);
        this.pending = this.pending.slice(nl + 1);
        if (line) await this.apply(parseLine(this.sodium, line));
      }
    } catch (error) {
      await this.abort();
      throw error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error : new Error('MALFORMED');
    }
  }

  /** Call after the last piece. Verifies completeness; returns what was restored. */
  async finish(): Promise<BundleSummary> {
    if (!this.finalSeen || !this.ended || this.pending.trim() || !this.publicKeyHex) {
      await this.abort();
      throw new Error('INCOMPLETE');
    }
    this.db?.close();
    this.db = null;
    this.release();
    return { records: this.records, settings: this.settings, publicKeyHex: this.publicKeyHex };
  }

  async abort(): Promise<void> {
    if (this.failed) return;
    this.failed = true;
    try {
      const db = this.db ?? await openDB();
      for (const store of Array.from(db.objectStoreNames)) await idbClear(db, store);
      db.close();
    } catch { /* best effort */ }
    this.db = null;
    this.release();
  }

  private async apply(entry: any): Promise<void> {
    if (!entry || typeof entry !== 'object') throw new Error('MALFORMED');
    if (!this.header) {
      if (entry.kant !== 'bundle' || entry.v !== BUNDLE_VERSION) throw new Error('UNSUPPORTED');
      this.header = entry;
      return;
    }
    if (this.ended) throw new Error('MALFORMED');
    if (entry.end === true) {
      if (entry.records !== this.records) throw new Error('INCOMPLETE');
      this.ended = true;
      return;
    }
    if (entry.settings && typeof entry.settings === 'object') {
      for (const [k, v] of Object.entries(entry.settings)) {
        if (typeof v === 'string' && /^kant[\w.-]{0,60}$/.test(k)) this.settings[k] = v;
      }
      return;
    }
    const store = entry.s;
    if (typeof store !== 'string' || !STORE_NAMES.has(store) || entry.v === undefined) throw new Error('MALFORMED');
    if (!this.header.sessions && SESSION_STORES.has(store)) throw new Error('MALFORMED');
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const req = hasKeyPath(store) ? os.put(entry.v) : os.put(entry.v, entry.k);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (store === 'identity' && typeof entry.v?.publicKeyHex === 'string') this.publicKeyHex = entry.v.publicKeyHex;
    this.records++;
  }
}

/* ── Backup file ─────────────────────────────────────────────────────── */

const MAGIC = new TextEncoder().encode('KANTBAK1');

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/**
 * An encrypted backup of this identity. The password must be the account
 * password (checked here); it also keys the file, with its own salt.
 *
 * Layout: "KANTBAK1" · version (1 byte) · salt (16) · then length-prefixed
 * pieces: the secretstream header, then each sealed chunk.
 */
export async function createBackupFile(password: string, options: Omit<BundleOptions, 'includeSessions'>): Promise<Uint8Array> {
  const check = await unlockIdentityChecked(password);
  if (check.kind !== 'ok') throw new Error('WRONG_PASSWORD');
  const sodium = await getSodium();
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = await deriveKey(password, salt);
  const parts: Uint8Array[] = [MAGIC, new Uint8Array([BUNDLE_VERSION]), salt];
  for await (const piece of sealedBundle(key, { ...options, includeSessions: false })) parts.push(u32(piece.length), piece);
  key.fill(0);
  return concat(parts);
}

/** Whether `bytes` looks like a Kant backup file (before asking for the password). */
export function isBackupFile(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length + 1 && MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Restore a backup file into this (empty) device. The password is the account
 * password at the time of the backup; afterwards Kant unlocks with it as usual.
 * Throws WRONG_PASSWORD, NOT_A_BACKUP, IDENTITY_EXISTS, INCOMPLETE or MALFORMED.
 */
export async function restoreBackupFile(bytes: Uint8Array, password: string, onProgress?: (fraction: number) => void): Promise<BundleSummary> {
  if (!isBackupFile(bytes)) throw new Error('NOT_A_BACKUP');
  if (bytes[MAGIC.length] !== BUNDLE_VERSION) throw new Error('UNSUPPORTED');
  const sodium = await getSodium();
  let offset = MAGIC.length + 1;
  const salt = bytes.slice(offset, offset + sodium.crypto_pwhash_SALTBYTES);
  offset += sodium.crypto_pwhash_SALTBYTES;
  const key = await deriveKey(password, salt);
  const restorer = new BundleRestorer(key);
  await restorer.begin();
  const next = (): Uint8Array | null => {
    if (offset + 4 > bytes.length) return null;
    const len = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    if (offset + 4 + len > bytes.length) return null;
    const piece = bytes.subarray(offset + 4, offset + 4 + len);
    offset += 4 + len;
    return piece;
  };
  try {
    const header = next();
    if (!header) throw new Error('INCOMPLETE');
    try { await restorer.start(header); } catch { throw new Error('WRONG_PASSWORD'); }
    let piece: Uint8Array | null;
    let first = true;
    while ((piece = next())) {
      try { await restorer.push(piece); } catch (e) {
        throw first && e instanceof Error && e.message === 'BAD_KEY' ? new Error('WRONG_PASSWORD') : e;
      }
      first = false;
      onProgress?.(offset / bytes.length);
    }
    if (offset !== bytes.length) throw new Error('MALFORMED');
    const summary = await restorer.finish();
    // The restored identity must open with this password, or Kant could never unlock it.
    const check = await unlockIdentityChecked(password);
    if (check.kind !== 'ok') throw new Error('WRONG_PASSWORD');
    return summary;
  } catch (error) {
    await restorer.abort();
    throw error;
  } finally {
    key.fill(0);
  }
}
