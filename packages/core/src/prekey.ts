/**
 * Kant Pre-Key Bundle — serve and fetch X3DH public bundles over P2P
 *
 * Protocol: /kant/prekey/1.0.0
 * Request:  empty (just open stream)
 * Response: JSON { identityKey: number[], signedPreKey: number[], spkSig: number[],
 *                  ed25519PubKey: number[], opkPublicKey?: number[], opkId?: string }
 *
 * The SPK is signed with the sender's Ed25519 identity key so the receiver
 * can verify it wasn't substituted by a MITM.
 *
 * SPK rotation: a new SPK is generated every 24 hours. The previous SPK is
 * retained for one additional rotation period so in-flight X3DH initiations
 * that fetched the old bundle can still complete.
 *
 * OPK pool: a pool of 20 one-time pre-keys is maintained. One OPK is included
 * in each bundle response and burned (deleted) on X3DH receive. The pool is
 * replenished asynchronously when it drops below 5 keys. If the pool is empty
 * the bundle is served without an OPK (SPK-only fallback, logged as a warning).
 */

import { generateX25519Keypair, ed25519ToX25519 } from './ratchet.js';
import type { X25519Keypair, X3DHPublicBundle, X3DHPrivateBundle } from './ratchet.js';
import type { StoredKeypair } from './identity.js';
import type { Libp2p } from 'libp2p';
import { getSodium } from './sodium.js';
import { withSendLock, getOrDialPeer } from './send-lock.js';
import { openDB, idbDelete, idbGet, idbPut } from './db.js';

export const PREKEY_PROTOCOL = '/kant/prekey/1.0.0';

const STORE          = 'prekeys';
const SPK_CURRENT    = 'spk_current';
const SPK_PREVIOUS   = 'spk_previous';
const SPK_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const OPK_POOL_SIZE      = 20;
const OPK_MAX_STORED     = 100;
const OPK_PREFIX         = 'opk_';
const OPK_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
let replenishInFlight: Promise<void> | null = null;

interface SPKEntry extends X25519Keypair {
  createdAt: number;
}

interface OPKEntry extends X25519Keypair {
  id: string;
  createdAt: number;
  reservedAt?: number;
}

/** Hard cap on a single length-prefixed frame (16 MiB) to bound memory. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * Get or create the local signed pre-key, persisted in IndexedDB.
 * Rotates automatically every 24 hours.
 * The previous SPK is kept for one additional period so in-flight X3DH
 * initiations that fetched the old bundle can still complete.
 */
export async function getOrCreateSPK(): Promise<X25519Keypair> {
  const db      = await openDB();
  const current = await idbGet<SPKEntry>(db, STORE, SPK_CURRENT);

  if (current) {
    const age = Date.now() - (current.createdAt ?? 0);
    if (age <= SPK_MAX_AGE_MS) {
      db.close();
      return { publicKey: current.publicKey, privateKey: current.privateKey };
    }
    // Rotate: archive current → previous, generate new current
    await idbPut(db, STORE, current, SPK_PREVIOUS);
  }

  const spk: SPKEntry = { ...(await generateX25519Keypair()), createdAt: Date.now() };
  await idbPut(db, STORE, spk, SPK_CURRENT);
  db.close();
  return { publicKey: spk.publicKey, privateKey: spk.privateKey };
}

/**
 * Try to find a matching SPK (current or previous) by public key.
 * Used during X3DH receive to handle messages that arrived after rotation.
 */
export async function findSPKByPublicKey(pubKey: Uint8Array): Promise<X25519Keypair | null> {
  const db      = await openDB();
  const current  = await idbGet<SPKEntry>(db, STORE, SPK_CURRENT);
  const previous = await idbGet<SPKEntry>(db, STORE, SPK_PREVIOUS);
  db.close();

  for (const entry of [current, previous]) {
    if (!entry) continue;
    if (entry.publicKey.length === pubKey.length &&
        entry.publicKey.every((b, i) => b === pubKey[i])) {
      return { publicKey: entry.publicKey, privateKey: entry.privateKey };
    }
  }
  return null;
}

// ── OPK pool management ───────────────────────────────────────────────────────

function opkKey(id: string): string { return OPK_PREFIX + id; }

/** Generate a fresh OPK id */
function newOpkId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
}

async function replenishOPKPoolUnlocked(): Promise<void> {
  const db  = await openDB();
  const entries = await new Promise<OPKEntry[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OPKEntry[]).filter(value => value?.id));
    req.onerror = () => reject(req.error);
  });
  const now = Date.now();
  const expired = entries.filter(entry => entry.reservedAt && now - entry.reservedAt >= OPK_RESERVATION_TTL_MS);
  for (const entry of expired) await idbDelete(db, STORE, opkKey(entry.id));
  const active = entries.filter(entry => !expired.includes(entry));
  const available = active.filter(entry => !entry.reservedAt);
  // Bound reserved-key growth if an attacker repeatedly requests bundles.
  // Once the cap is reached, serving SPK-only is safer than unbounded IDB use.
  const needed = Math.min(OPK_POOL_SIZE - available.length, OPK_MAX_STORED - active.length);
  if (needed <= 0) { db.close(); return; }
  for (let i = 0; i < needed; i++) {
    const id  = newOpkId();
    const kp  = await generateX25519Keypair();
    const entry: OPKEntry = { id, publicKey: kp.publicKey, privateKey: kp.privateKey, createdAt: Date.now() };
    await idbPut(db, STORE, entry, opkKey(id));
  }
  db.close();
}

/** Replenish the available OPK pool. Concurrent callers share one run. */
export async function replenishOPKPool(): Promise<void> {
  if (replenishInFlight) return replenishInFlight;
  replenishInFlight = replenishOPKPoolUnlocked().finally(() => { replenishInFlight = null; });
  return replenishInFlight;
}

/**
 * Select one OPK for inclusion in a bundle response.
 *
 * Reservation and selection happen in one IndexedDB read-write transaction.
 * This prevents simultaneous bundle requests from receiving the same OPK,
 * while retaining the private half until the matching handshake consumes it.
 *
 * Returns null if the pool is empty (SPK-only fallback).
 * Triggers async replenishment if the pool is running low.
 */
export async function reserveOPK(): Promise<OPKEntry | null> {
  const db  = await openDB();
  const entry = await new Promise<OPKEntry | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let oldest: OPKEntry | null = null;
    let selected: OPKEntry | null = null;
    const cursorRequest = store.openCursor();
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        const candidate = cursor.value as OPKEntry;
        if (candidate?.id && !candidate.reservedAt && (!oldest || candidate.createdAt < oldest.createdAt)) {
          oldest = candidate;
        }
        cursor.continue();
        return;
      }
      if (oldest) {
        selected = { ...oldest, reservedAt: Date.now() };
        store.put(selected, opkKey(selected.id));
      }
    };
    tx.oncomplete = () => resolve(selected);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('OPK reservation transaction aborted'));
  });
  db.close();
  if (!entry) console.warn('[prekey] OPK pool empty — serving SPK-only bundle');
  void replenishOPKPool();
  return entry;
}

/** Read a reserved OPK without consuming it. The caller must burn it only
 * after the authenticated payload has decrypted successfully. */
export async function getOPK(id: string): Promise<OPKEntry | null> {
  const db = await openDB();
  const entry = await idbGet<OPKEntry>(db, STORE, opkKey(id));
  db.close();
  return entry?.reservedAt ? entry : null;
}

/**
 * Look up an OPK by ID and delete it (burn on use during X3DH receive).
 * Returns null if the OPK was already consumed or never existed.
 */
export async function burnOPK(id: string): Promise<OPKEntry | null> {
  const db = await openDB();
  const entry = await new Promise<OPKEntry | null>((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let consumed: OPKEntry | null = null;
    const get = store.get(opkKey(id));
    get.onsuccess = () => {
      consumed = (get.result as OPKEntry | undefined) ?? null;
      if (consumed) store.delete(opkKey(id));
    };
    get.onerror = () => reject(get.error);
    tx.oncomplete = () => resolve(consumed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('OPK burn transaction aborted'));
  });
  db.close();
  if (entry) void replenishOPKPool();
  return entry;
}

/** Build the full private bundle for X3DH receive side */
export async function buildPrivateBundle(identity: StoredKeypair): Promise<X3DHPrivateBundle> {
  const identityKeypair  = await ed25519ToX25519(identity.publicKey, identity.privateKey);
  const signedPreKeypair = await getOrCreateSPK();
  return { identityKeypair, signedPreKeypair };
}

/** Build the public bundle to send to a peer */
export async function buildPublicBundle(identity: StoredKeypair): Promise<X3DHPublicBundle> {
  const { identityKeypair, signedPreKeypair } = await buildPrivateBundle(identity);
  return {
    identityKey:  identityKeypair.publicKey,
    signedPreKey: signedPreKeypair.publicKey,
  };
}

async function readFramed(stream: any): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let expectedLen: number | null = null;
    let received = 0;

    function tryResolve(): boolean {
      if (expectedLen === null) {
        if (received < 4) return false;
        const total = new Uint8Array(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) { total.set(c, offset); offset += c.length; }
        const view = new DataView(total.buffer, total.byteOffset, 4);
        expectedLen = view.getUint32(0, false);
        if (expectedLen > MAX_FRAME_BYTES) {
          reject(new Error(`Frame too large: ${expectedLen} > ${MAX_FRAME_BYTES}`));
          return true;
        }
        const firstPayload = total.subarray(4);
        chunks.length = 0;
        received = firstPayload.length;
        if (received > 0) chunks.push(firstPayload);
      }
      if (received >= expectedLen) {
        const total = new Uint8Array(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) { total.set(c, offset); offset += c.length; }
        resolve(total.subarray(0, expectedLen));
        return true;
      }
      return false;
    }

    stream.addEventListener('message', (evt: any) => {
      const data = evt.data instanceof Uint8Array ? evt.data : evt.data.subarray();
      chunks.push(data);
      received += data.length;
      tryResolve();
    });
    stream.addEventListener('remoteCloseWrite', () => {
      if (!tryResolve()) reject(new Error('Stream closed early'));
    });
    stream.addEventListener('close', (evt: any) => {
      if (evt.error) reject(evt.error);
      else if (!tryResolve()) reject(new Error('Stream closed early'));
    });
  });
}

/** Register the prekey protocol handler on a node */
export async function registerPrekeyHandler(node: Libp2p, identity: StoredKeypair): Promise<void> {
  const sodium = await getSodium();
  // Ensure the OPK pool is populated on startup
  void replenishOPKPool();
  await node.handle(PREKEY_PROTOCOL, async (stream: any) => {
    try {
      const bundle = await buildPublicBundle(identity);
      const spkSig = sodium.crypto_sign_detached(bundle.signedPreKey, identity.privateKey);
      // Pop one OPK to include in the bundle (null = pool empty, SPK-only fallback)
      const opk = await reserveOPK();
      const responseObj: Record<string, any> = {
        identityKey:   Array.from(bundle.identityKey),
        signedPreKey:  Array.from(bundle.signedPreKey),
        spkSig:        Array.from(spkSig),
        ed25519PubKey: Array.from(identity.publicKey),
      };
      if (opk) {
        responseObj.opkPublicKey = Array.from(opk.publicKey);
        responseObj.opkId        = opk.id;
      }
      const payload = new TextEncoder().encode(JSON.stringify(responseObj));
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, payload.length, false);
      const framed = new Uint8Array(4 + payload.length);
      framed.set(header);
      framed.set(payload, 4);
      stream.send(framed);
      await stream.close();
    } catch (e) {
      console.error('[prekey handler] error:', e);
      stream.abort(e as Error);
    }
  }, { runOnLimitedConnection: true });
}

/** Fetch a peer's X3DH public bundle over the prekey protocol.
 *  expectedEd25519PubHex: the contact's known Ed25519 public key hex — the bundle
 *  is rejected if the signing key in the response does not match, blocking MITM. */
export async function fetchPreKeyBundle(node: Libp2p, peerCircuitAddr: string, expectedEd25519PubHex?: string): Promise<X3DHPublicBundle> {
  return withSendLock(node, peerCircuitAddr, () => fetchPreKeyBundleUnlocked(node, peerCircuitAddr, expectedEd25519PubHex));
}

async function fetchPreKeyBundleUnlocked(node: Libp2p, peerCircuitAddr: string, expectedEd25519PubHex?: string): Promise<X3DHPublicBundle> {
  const sodium = await getSodium();
  let conn: any;
  let lastError: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      conn = await getOrDialPeer(node, peerCircuitAddr);
      break;
    } catch (e: any) {
      lastError = e;
      if (attempt < 4) await new Promise(r => setTimeout(r, 500 + attempt * 400));
    }
  }
  if (!conn) throw lastError;

  const stream: any = await conn.newStream(PREKEY_PROTOCOL, { runOnLimitedConnection: true });
  let raw: Uint8Array;
  try {
    raw = await readFramed(stream);
  } catch (e: any) {
    throw new Error(`fetchPreKeyBundle(${peerCircuitAddr}) readFramed failed: ${e?.message ?? e}`);
  }
  const json = JSON.parse(new TextDecoder().decode(raw));

  const identityKey  = new Uint8Array(json.identityKey);
  const signedPreKey = new Uint8Array(json.signedPreKey);

  if (!json.spkSig?.length || !json.ed25519PubKey?.length) {
    throw new Error('Pre-key bundle missing SPK signature — rejected for security');
  }

  const spkSig     = new Uint8Array(json.spkSig);
  const ed25519Pub = new Uint8Array(json.ed25519PubKey);

  // Verify the bundle's identity key matches the contact we dialled.
  // Without this check, a MITM could substitute a bundle signed by a different
  // (attacker-controlled) key and the signature verification below would still pass.
  if (expectedEd25519PubHex) {
    const actualHex = sodium.to_hex(ed25519Pub);
    if (actualHex !== expectedEd25519PubHex.toLowerCase()) {
      throw new Error('Pre-key bundle identity key mismatch — possible MITM');
    }
  }

  const valid = sodium.crypto_sign_verify_detached(spkSig, signedPreKey, ed25519Pub);
  if (!valid) throw new Error('SPK signature verification failed — possible MITM');

  const bundle: X3DHPublicBundle = { identityKey, signedPreKey };
  if (json.opkPublicKey?.length && typeof json.opkId === 'string') {
    (bundle as any).opkPublicKey = new Uint8Array(json.opkPublicKey);
    (bundle as any).opkId        = json.opkId;
  }
  return bundle;
}
