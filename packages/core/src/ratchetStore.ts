/**
 * Encrypted-at-rest persistence for double-ratchet state.
 *
 * Ratchet state used to live only in a React ref, so every reload, restart or
 * process kill silently destroyed it. The peer would keep sending on the old
 * chain, we could not decrypt, and we replied with an x3dh-reset — which made a
 * perfectly delivered message look like a delivery failure. Persisting the
 * chain means a restart resumes the conversation instead of renegotiating it.
 *
 * This holds live key material, so it is sealed with a subkey of the identity's
 * password-derived key, exactly as messages.ts does. It is no more sensitive
 * than the message history stored beside it, and it never leaves the device.
 */
import { getSodium } from './sodium.js';
import { openDB, idbPut, idbDelete, idbGetAll } from './db.js';
import type { RatchetState } from './ratchet.js';

const STORE = 'ratchets';

interface StoredRatchet {
  contactPubkeyHex: string;
  /** secretbox(nonce || ciphertext) over the JSON form below. */
  blob: Uint8Array;
  updatedAt: number;
}

/** JSON-safe mirror of RatchetState — Uint8Arrays become base64. */
interface RatchetJson {
  rootKey: string;
  sendingChainKey: string;
  receivingChainKey: string;
  sendingRatchetPublic: string;
  sendingRatchetPrivate: string;
  receivingRatchetPublic: string;
  sendingNumber: number;
  receivingNumber: number;
  previousReceivingChainKey: string | null;
}

/** Distinct subkey id from messages.ts (1) so the two ciphertexts never share a key. */
function deriveRatchetKey(sodium: any, derivedKey: Uint8Array): Uint8Array {
  return sodium.crypto_kdf_derive_from_key(32, 2, 'kantratc', derivedKey);
}

const b64 = (sodium: any, b: Uint8Array): string =>
  sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
const unb64 = (sodium: any, s: string): Uint8Array =>
  sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

function toJson(sodium: any, state: RatchetState): RatchetJson {
  return {
    rootKey:                   b64(sodium, state.rootKey),
    sendingChainKey:           b64(sodium, state.sendingChainKey),
    receivingChainKey:         b64(sodium, state.receivingChainKey),
    sendingRatchetPublic:      b64(sodium, state.sendingRatchetKeyPair.publicKey),
    sendingRatchetPrivate:     b64(sodium, state.sendingRatchetKeyPair.privateKey),
    receivingRatchetPublic:    b64(sodium, state.receivingRatchetPublic),
    sendingNumber:             state.sendingNumber,
    receivingNumber:           state.receivingNumber,
    previousReceivingChainKey: state.previousReceivingChainKey
      ? b64(sodium, state.previousReceivingChainKey) : null,
  };
}

function fromJson(sodium: any, json: RatchetJson): RatchetState {
  return {
    rootKey:           unb64(sodium, json.rootKey),
    sendingChainKey:   unb64(sodium, json.sendingChainKey),
    receivingChainKey: unb64(sodium, json.receivingChainKey),
    sendingRatchetKeyPair: {
      publicKey:  unb64(sodium, json.sendingRatchetPublic),
      privateKey: unb64(sodium, json.sendingRatchetPrivate),
    },
    receivingRatchetPublic: unb64(sodium, json.receivingRatchetPublic),
    sendingNumber:          json.sendingNumber,
    receivingNumber:        json.receivingNumber,
    previousReceivingChainKey: json.previousReceivingChainKey
      ? unb64(sodium, json.previousReceivingChainKey) : null,
  };
}

/**
 * Persist one conversation's ratchet. Call after every send and every
 * successful receive — those are exactly the points where the chain advances,
 * and a state one step behind cannot decrypt the next message.
 */
export async function saveRatchet(
  contactPubkeyHex: string,
  derivedKey: Uint8Array,
  state: RatchetState,
): Promise<void> {
  const sodium = await getSodium();
  const key   = deriveRatchetKey(sodium, derivedKey);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plain = new TextEncoder().encode(JSON.stringify(toJson(sodium, state)));
  const ct    = sodium.crypto_secretbox_easy(plain, nonce, key);

  const blob = new Uint8Array(nonce.length + ct.length);
  blob.set(nonce, 0);
  blob.set(ct, nonce.length);

  const db = await openDB();
  await idbPut(db, STORE, { contactPubkeyHex, blob, updatedAt: Date.now() } as StoredRatchet);
  db.close();
}

/**
 * Load every stored ratchet. A record that fails to open is dropped rather than
 * thrown: a corrupt or stale-key entry must not block unlocking the app, and
 * the peer can always re-handshake.
 */
export async function loadRatchets(derivedKey: Uint8Array): Promise<Map<string, RatchetState>> {
  const sodium = await getSodium();
  const key = deriveRatchetKey(sodium, derivedKey);
  const db  = await openDB();
  const rows = await idbGetAll<StoredRatchet>(db, STORE);
  db.close();

  const out = new Map<string, RatchetState>();
  for (const row of rows) {
    try {
      const blob  = row.blob instanceof Uint8Array ? row.blob : new Uint8Array(row.blob as any);
      const nonce = blob.slice(0, sodium.crypto_secretbox_NONCEBYTES);
      const ct    = blob.slice(sodium.crypto_secretbox_NONCEBYTES);
      const plain = sodium.crypto_secretbox_open_easy(ct, nonce, key);
      out.set(row.contactPubkeyHex, fromJson(sodium, JSON.parse(new TextDecoder().decode(plain))));
    } catch {
      // Unreadable entry — skip it and let the conversation renegotiate.
    }
  }
  return out;
}

/** Drop a conversation's chain, e.g. on x3dh-reset or contact deletion. */
export async function deleteRatchet(contactPubkeyHex: string): Promise<void> {
  const db = await openDB();
  await idbDelete(db, STORE, contactPubkeyHex);
  db.close();
}
