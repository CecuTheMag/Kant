/**
 * Kant Pre-Key Bundle — serve and fetch X3DH public bundles over P2P
 *
 * Protocol: /kant/prekey/1.0.0
 * Request:  empty (just open stream)
 * Response: JSON { identityKey: number[], signedPreKey: number[] }
 */

import { generateX25519Keypair, ed25519ToX25519 } from './ratchet';
import type { X25519Keypair, X3DHPublicBundle, X3DHPrivateBundle } from './ratchet';
import type { StoredKeypair } from './identity.js';
import type { Libp2p } from 'libp2p';
import { multiaddr } from '@multiformats/multiaddr';

export const PREKEY_PROTOCOL = '/kant/prekey/1.0.0';

const DB_NAME = 'kant';
const DB_VERSION = 2;
const STORE = 'prekeys';
const SPK_KEY = 'spk';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(db: IDBDatabase, key: string): Promise<X25519Keypair | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(db: IDBDatabase, key: string, value: X25519Keypair): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Get or create the local signed pre-key, persisted in IndexedDB */
export async function getOrCreateSPK(): Promise<X25519Keypair> {
  const db = await openDB();
  let spk = await dbGet(db, SPK_KEY);
  if (!spk) {
    spk = await generateX25519Keypair();
    await dbPut(db, SPK_KEY, spk);
  }
  db.close();
  return spk;
}

/** Build the full private bundle for X3DH receive side */
export async function buildPrivateBundle(identity: StoredKeypair): Promise<X3DHPrivateBundle> {
  const identityKeypair = await ed25519ToX25519(identity.publicKey, identity.privateKey);
  const signedPreKeypair = await getOrCreateSPK();
  return { identityKeypair, signedPreKeypair };
}

/** Build the public bundle to send to a peer */
export async function buildPublicBundle(identity: StoredKeypair): Promise<X3DHPublicBundle> {
  const { identityKeypair, signedPreKeypair } = await buildPrivateBundle(identity);
  return {
    identityKey: identityKeypair.publicKey,
    signedPreKey: signedPreKeypair.publicKey
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll(stream: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
  }
  const total = new Uint8Array(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { total.set(c, offset); offset += c.length; }
  return total;
}

/** Register the prekey protocol handler on a node */
export async function registerPrekeyHandler(node: Libp2p, identity: StoredKeypair): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await node.handle(PREKEY_PROTOCOL, async (stream: any) => {
    const bundle = await buildPublicBundle(identity);
    const payload = JSON.stringify({
      identityKey: Array.from(bundle.identityKey),
      signedPreKey: Array.from(bundle.signedPreKey)
    });
    stream.send(new TextEncoder().encode(payload));
    await stream.close();
  }, { runOnLimitedConnection: true });
}

/** Fetch a peer's X3DH public bundle over the prekey protocol */
export async function fetchPreKeyBundle(node: Libp2p, peerCircuitAddr: string): Promise<X3DHPublicBundle> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await node.dialProtocol(multiaddr(peerCircuitAddr), PREKEY_PROTOCOL, { runOnLimitedConnection: true });
  await stream.close();
  const raw = await readAll(stream);
  const json = JSON.parse(new TextDecoder().decode(raw));
  return {
    identityKey: new Uint8Array(json.identityKey),
    signedPreKey: new Uint8Array(json.signedPreKey)
  };
}
