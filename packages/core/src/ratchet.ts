/**
 * Kant Ratchet — X3DH key exchange + Double Ratchet encryption
 */

import { getSodium } from './sodium.js';

export interface X25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface X3DHPublicBundle {
  identityKey: Uint8Array;
  signedPreKey: Uint8Array;
  /** One-time pre-key (optional). Present when the remote's OPK pool is non-empty. */
  opkPublicKey?: Uint8Array;
  /** ID of the OPK so the receiver can look it up and burn it. */
  opkId?: string;
}

export interface X3DHPrivateBundle {
  identityKeypair: X25519Keypair;
  signedPreKeypair: X25519Keypair;
}

export interface RatchetState {
  rootKey: Uint8Array;
  sendingChainKey: Uint8Array;
  receivingChainKey: Uint8Array;
  sendingRatchetKeyPair: X25519Keypair;
  receivingRatchetPublic: Uint8Array;
  sendingNumber: number;
  /**
   * Messages received on the current receiving chain (Nr). Only meaningful when
   * `chainCounters` is set — see below.
   */
  receivingNumber: number;
  previousReceivingChainKey: Uint8Array | null;
  /** Length of our previous sending chain (PN), sent as header.prevChainLen. */
  previousSendingNumber?: number;
  /**
   * True once `receivingNumber` counts per receiving chain. Sessions persisted
   * by builds before skipped-key support counted globally; they decrypt
   * sequentially (the old behaviour) until their next DH ratchet step, which
   * resets the counter and turns this on.
   */
  chainCounters?: boolean;
  /**
   * Message keys for messages that were skipped (arrived later, or not yet),
   * keyed by `${dhPublicHex}:${msgNum}`. Bounded in count and age; each key is
   * deleted the moment it is used, so a replay cannot decrypt twice.
   */
  skipped?: Map<string, SkippedKey>;
}

export interface SkippedKey { key: Uint8Array; at: number }

/**
 * Double Ratchet skipped-message-key bounds (Signal spec §3.2 MAX_SKIP). A
 * peer claiming a jump larger than this is refused outright; the store keeps
 * the most recent keys only and forgets keys older than the age limit, which
 * caps the forward-secrecy cost of holding them.
 */
export const RATCHET_LIMITS = {
  maxSkip: 1000,
  maxStoredSkipped: 2000,
  maxSkippedAgeMs: 14 * 24 * 60 * 60 * 1000,
} as const;

export interface EncryptedMessage {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  header: {
    dhPublic: Uint8Array;
    msgNum: number;
    prevChainLen: number;
  };
  /** @deprecated use header.dhPublic */
  ephemeralPublicKey: Uint8Array;
}

export async function generateX25519Keypair(): Promise<X25519Keypair> {
  const sodium = await getSodium();
  // crypto_box_keypair generates a proper Curve25519 keypair usable with crypto_scalarmult
  const kp = sodium.crypto_box_keypair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  };
}

export async function ed25519ToX25519(publicKey: Uint8Array, privateKey: Uint8Array): Promise<X25519Keypair> {
  const sodium = await getSodium();
  const xPublicKey = sodium.crypto_sign_ed25519_pk_to_curve25519(publicKey);
  const xPrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(privateKey);
  return {
    publicKey: xPublicKey,
    privateKey: xPrivateKey,
  };
}

/** Convert a contact's hex-encoded Ed25519 public key to its X25519 public key.
 *  Used to seal a per-file key to a recipient when only their public key is known. */
export async function ed25519PubToX25519(pubkeyHex: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_sign_ed25519_pk_to_curve25519(sodium.from_hex(pubkeyHex));
}

async function kdf(sodium: any, inputKey: Uint8Array, context: string): Promise<Uint8Array[]> {
  // Pad/hash context to exactly 8 bytes as required by crypto_kdf_derive_from_key
  const ctx = context.padEnd(8, '\0').slice(0, 8);
  const key = inputKey.length === 32 ? inputKey : sodium.crypto_generichash(32, inputKey);
  const k1 = sodium.crypto_kdf_derive_from_key(32, 1, ctx, key);
  const k2 = sodium.crypto_kdf_derive_from_key(32, 2, ctx, key);
  return [k1, k2];
}

export async function x3dhSend(
  myX25519: X25519Keypair,
  publicBundle: X3DHPublicBundle
): Promise<{ sharedSecret: Uint8Array; ephemeralPublic: Uint8Array; opkId?: string }> {
  const sodium = await getSodium();
  const ephemeralKp = await generateX25519Keypair();

  // Signal X3DH spec (with optional OPK — DH4):
  //   DH1 = DH(EK_A,  IK_B)   — ephemeral × Bob identity
  //   DH2 = DH(EK_A,  SPK_B)  — ephemeral × Bob signed pre-key
  //   DH3 = DH(IK_A,  SPK_B)  — Alice identity × Bob signed pre-key
  //   DH4 = DH(EK_A,  OPK_B)  — ephemeral × Bob one-time pre-key (when present)
  const dh1 = sodium.crypto_scalarmult(ephemeralKp.privateKey, publicBundle.identityKey);
  const dh2 = sodium.crypto_scalarmult(ephemeralKp.privateKey, publicBundle.signedPreKey);
  const dh3 = sodium.crypto_scalarmult(myX25519.privateKey,    publicBundle.signedPreKey);

  let kdfInput: Uint8Array;
  if (publicBundle.opkPublicKey && publicBundle.opkId) {
    const dh4 = sodium.crypto_scalarmult(ephemeralKp.privateKey, publicBundle.opkPublicKey);
    kdfInput = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
    kdfInput.set(dh1);
    kdfInput.set(dh2, dh1.length);
    kdfInput.set(dh3, dh1.length + dh2.length);
    kdfInput.set(dh4, dh1.length + dh2.length + dh3.length);
  } else {
    kdfInput = new Uint8Array(dh1.length + dh2.length + dh3.length);
    kdfInput.set(dh1);
    kdfInput.set(dh2, dh1.length);
    kdfInput.set(dh3, dh1.length + dh2.length);
  }

  const [sharedSecret] = await kdf(sodium, kdfInput, 'x3dh');
  return { sharedSecret, ephemeralPublic: ephemeralKp.publicKey, opkId: publicBundle.opkId };
}

export async function x3dhReceive(
  privateBundle: X3DHPrivateBundle,
  aliceIdentityPub: Uint8Array,
  ephemeralPub: Uint8Array,
  opkPrivateKey?: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();

  // Mirror of x3dhSend (with optional OPK — DH4):
  //   DH1 = DH(IK_B,  EK_A)   — Bob identity × Alice ephemeral
  //   DH2 = DH(SPK_B, EK_A)   — Bob signed pre-key × Alice ephemeral
  //   DH3 = DH(SPK_B, IK_A)   — Bob signed pre-key × Alice identity
  //   DH4 = DH(OPK_B, EK_A)   — Bob one-time pre-key × Alice ephemeral (when present)
  const dh1 = sodium.crypto_scalarmult(privateBundle.identityKeypair.privateKey,  ephemeralPub);
  const dh2 = sodium.crypto_scalarmult(privateBundle.signedPreKeypair.privateKey, ephemeralPub);
  const dh3 = sodium.crypto_scalarmult(privateBundle.signedPreKeypair.privateKey, aliceIdentityPub);

  let kdfInput: Uint8Array;
  if (opkPrivateKey) {
    const dh4 = sodium.crypto_scalarmult(opkPrivateKey, ephemeralPub);
    kdfInput = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
    kdfInput.set(dh1);
    kdfInput.set(dh2, dh1.length);
    kdfInput.set(dh3, dh1.length + dh2.length);
    kdfInput.set(dh4, dh1.length + dh2.length + dh3.length);
  } else {
    kdfInput = new Uint8Array(dh1.length + dh2.length + dh3.length);
    kdfInput.set(dh1);
    kdfInput.set(dh2, dh1.length);
    kdfInput.set(dh3, dh1.length + dh2.length);
  }

  const [sharedSecret] = await kdf(sodium, kdfInput, 'x3dh');
  return sharedSecret;
}

/**
 * Whether an x3dh-init's sender X25519 key is the one derived from the Ed25519
 * identity it claims. Only then does DH3 (SPK_B × IK_A) require that identity's
 * private key. Without this check anyone could open a session under a
 * contact's name using their own identity key, and be shown as that contact.
 */
export async function x3dhInitMatchesIdentity(claimedEd25519Hex: unknown, aliceIdentityPub: Uint8Array): Promise<boolean> {
  if (typeof claimedEd25519Hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(claimedEd25519Hex)) return false;
  const sodium = await getSodium();
  if (aliceIdentityPub.length !== sodium.crypto_scalarmult_BYTES) return false;
  let expected: Uint8Array;
  try { expected = sodium.crypto_sign_ed25519_pk_to_curve25519(sodium.from_hex(claimedEd25519Hex)); }
  catch { return false; } // not a valid Ed25519 point
  return sodium.memcmp(expected, aliceIdentityPub);
}

export async function initSenderRatchet(sharedSecret: Uint8Array, bobSignedPrePublic: Uint8Array): Promise<RatchetState> {
  const sodium = await getSodium();
  const [rootKey0, initialChainKey] = await kdf(sodium, sharedSecret, 'ratchet-init');
  const sendingRatchetKeyPair = await generateX25519Keypair();

  // Initial DH ratchet step: [rootKey, sendingChainKey] = KDF_RK(rootKey0, DH(newKP, bobSPK))
  const dh = sodium.crypto_scalarmult(sendingRatchetKeyPair.privateKey, bobSignedPrePublic);
  const rkInput = new Uint8Array(rootKey0.length + dh.length);
  rkInput.set(rootKey0);
  rkInput.set(dh, rootKey0.length);
  const [rootKey1, sendingChainKey] = await kdf(sodium, rkInput, 'root-ratchet');

  return {
    rootKey: rootKey1,
    sendingChainKey,
    receivingChainKey: initialChainKey,
    sendingRatchetKeyPair,
    receivingRatchetPublic: bobSignedPrePublic,
    sendingNumber: 0,
    receivingNumber: 0,
    previousReceivingChainKey: null,
    previousSendingNumber: 0,
    chainCounters: true,
    skipped: new Map(),
  };
}

export async function initReceiverRatchet(sharedSecret: Uint8Array, signedPreKeyPair: X25519Keypair): Promise<RatchetState> {
  const sodium = await getSodium();
  const [rootKey, receivingChainKey] = await kdf(sodium, sharedSecret, 'ratchet-init');

  return {
    rootKey,
    sendingChainKey: new Uint8Array(32),
    receivingChainKey,
    sendingRatchetKeyPair: signedPreKeyPair,
    receivingRatchetPublic: signedPreKeyPair.publicKey,
    sendingNumber: 0,
    receivingNumber: 0,
    previousReceivingChainKey: null,
    previousSendingNumber: 0,
    chainCounters: true,
    skipped: new Map(),
  };
}

async function hkdfChain(sodium: any, chainKey: Uint8Array, context: string): Promise<[Uint8Array, Uint8Array]> {
  const ctx = context.padEnd(8, '\0').slice(0, 8);
  const messageKey = sodium.crypto_kdf_derive_from_key(32, 1, ctx, chainKey);
  const newChainKey = sodium.crypto_kdf_derive_from_key(32, 2, ctx, chainKey);
  return [messageKey, newChainKey];
}

async function dhRatchetStep(sodium: any, state: RatchetState, theirPub: Uint8Array): Promise<void> {
  // Signal Double Ratchet spec — both DH outputs must chain through the root key:
  //   Step 1: [rootKey',  receivingChainKey] = KDF_RK(rootKey,  DH(ourOldSendKP, theirPub))
  //   Step 2: [rootKey'', sendingChainKey]   = KDF_RK(rootKey', DH(newSendKP,    theirPub))
  const dh1 = sodium.crypto_scalarmult(state.sendingRatchetKeyPair.privateKey, theirPub);
  // kdf() takes the root key as the KDF master key when the input is 32 bytes;
  // we need to mix rootKey in explicitly — use HKDF-style: hash(rootKey || dh1)
  const rk1Input = new Uint8Array(state.rootKey.length + dh1.length);
  rk1Input.set(state.rootKey);
  rk1Input.set(dh1, state.rootKey.length);
  const [rootKey1, receivingChainKey] = await kdf(sodium, rk1Input, 'root-ratchet');

  const newSendingKP = await generateX25519Keypair();
  const dh2 = sodium.crypto_scalarmult(newSendingKP.privateKey, theirPub);
  const rk2Input = new Uint8Array(rootKey1.length + dh2.length);
  rk2Input.set(rootKey1);
  rk2Input.set(dh2, rootKey1.length);
  const [rootKey2, sendingChainKey] = await kdf(sodium, rk2Input, 'root-ratchet');

  state.rootKey = rootKey2;
  state.receivingChainKey = receivingChainKey;
  state.sendingChainKey = sendingChainKey;
  state.sendingRatchetKeyPair = newSendingKP;
  state.receivingRatchetPublic = theirPub;
  state.previousSendingNumber = state.sendingNumber;
  state.sendingNumber = 0;
  // A fresh receiving chain: from here on the counter is per chain.
  state.receivingNumber = 0;
  state.chainCounters = true;
}

export async function ratchetEncrypt(state: RatchetState, plaintext: string): Promise<EncryptedMessage> {
  const sodium = await getSodium();

  // Receiver-side ratchets start with a zero sending chain key and can only
  // send after the first DH ratchet step (triggered by decrypting the
  // sender's first encrypted message).  Guard against encrypting with zeros.
  if (state.sendingChainKey.every(b => b === 0)) {
    throw new Error('sending chain not yet initialised — receive a message first');
  }

  const [messageKey, newSendingChainKey] = await hkdfChain(sodium, state.sendingChainKey, 'send-msg');

  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    null,
    null,
    nonce,
    messageKey
  );

  const msgNum = state.sendingNumber;
  state.sendingChainKey = newSendingChainKey;
  state.sendingNumber++;

  return {
    ciphertext,
    nonce,
    header: { dhPublic: state.sendingRatchetKeyPair.publicKey, msgNum, prevChainLen: state.previousSendingNumber ?? 0 },
    ephemeralPublicKey: state.sendingRatchetKeyPair.publicKey,
  };
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const skippedId = (dh: Uint8Array, n: number): string => `${hex(dh)}:${n}`;

function validCounter(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

/**
 * Advance a (snapshot) receiving chain up to `until`, recording each skipped
 * message key in `added`. Refuses jumps beyond MAX_SKIP so a peer cannot make
 * us burn CPU and memory deriving keys.
 */
async function skipMessageKeys(
  sodium: any,
  snap: RatchetState,
  until: number,
  added: Map<string, SkippedKey>,
): Promise<void> {
  if (until <= snap.receivingNumber) return;
  if (until - snap.receivingNumber > RATCHET_LIMITS.maxSkip) {
    throw new Error(`ratchet: refusing to skip ${until - snap.receivingNumber} messages (max ${RATCHET_LIMITS.maxSkip})`);
  }
  const now = Date.now();
  while (snap.receivingNumber < until) {
    const [messageKey, next] = await hkdfChain(sodium, snap.receivingChainKey, 'send-msg');
    added.set(skippedId(snap.receivingRatchetPublic, snap.receivingNumber), { key: messageKey, at: now });
    snap.receivingChainKey = next;
    snap.receivingNumber++;
  }
}

function decryptWith(sodium: any, key: Uint8Array, msg: EncryptedMessage): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, msg.ciphertext, null, msg.nonce, key);
}

/** Merge newly skipped keys, drop the used one, then enforce the age and count bounds. */
function commitSkipped(state: RatchetState, added: Map<string, SkippedKey>, used: string | null): void {
  const store = state.skipped ?? new Map<string, SkippedKey>();
  if (used) store.delete(used);
  for (const [id, entry] of added) store.set(id, entry);
  const cutoff = Date.now() - RATCHET_LIMITS.maxSkippedAgeMs;
  for (const [id, entry] of store) if (entry.at < cutoff) store.delete(id);
  // Map iteration is insertion order, so the first entries are the oldest.
  while (store.size > RATCHET_LIMITS.maxStoredSkipped) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  state.skipped = store;
}

/**
 * Decrypt one message, tolerating loss and reordering within the bounds above.
 *
 * All work happens on a snapshot; the live state changes only after the AEAD
 * check passes. The message handler tries every known ratchet until one
 * succeeds, so a failed attempt must leave the state (including its skipped
 * keys) exactly as it was.
 */
export async function ratchetDecrypt(state: RatchetState, msg: EncryptedMessage): Promise<string> {
  const sodium = await getSodium();
  const dhPublic = msg.header?.dhPublic ?? msg.ephemeralPublicKey;
  const msgNum = msg.header?.msgNum;
  const prevChainLen = msg.header?.prevChainLen;

  // 1. A message we already skipped past: its key is waiting in the store.
  if (validCounter(msgNum) && state.skipped?.size) {
    const id = skippedId(dhPublic, msgNum);
    const stored = state.skipped.get(id);
    if (stored) {
      const plaintext = decryptWith(sodium, stored.key, msg); // throws on a wrong key — state untouched
      commitSkipped(state, new Map(), id);
      return new TextDecoder().decode(plaintext);
    }
  }

  const isNewDH = !state.receivingRatchetPublic ||
    dhPublic.length !== state.receivingRatchetPublic.length ||
    !dhPublic.every((b, i) => b === state.receivingRatchetPublic[i]);

  const snap: RatchetState = {
    rootKey:                   state.rootKey,
    sendingChainKey:           state.sendingChainKey,
    receivingChainKey:         state.receivingChainKey,
    sendingRatchetKeyPair:     state.sendingRatchetKeyPair,
    receivingRatchetPublic:    state.receivingRatchetPublic,
    sendingNumber:             state.sendingNumber,
    receivingNumber:           state.receivingNumber,
    previousReceivingChainKey: state.previousReceivingChainKey,
    previousSendingNumber:     state.previousSendingNumber,
    chainCounters:             state.chainCounters,
  };
  const added = new Map<string, SkippedKey>();

  if (isNewDH) {
    // Keep keys for the tail of the old chain the peer says it sent.
    if (snap.chainCounters && validCounter(prevChainLen)) {
      await skipMessageKeys(sodium, snap, prevChainLen, added);
    }
    await dhRatchetStep(sodium, snap, dhPublic);
  }

  if (snap.chainCounters && validCounter(msgNum)) {
    if (msgNum < snap.receivingNumber) {
      // Older than the chain position and not in the skipped store: a replay,
      // or a key we already expired. Never re-derive it.
      throw new Error('ratchet: message key already used or expired');
    }
    await skipMessageKeys(sodium, snap, msgNum, added);
  }

  const [messageKey, newChain] = await hkdfChain(sodium, snap.receivingChainKey, 'send-msg');

  // This throws if the key is wrong — snap is discarded, state is untouched.
  const plaintext = decryptWith(sodium, messageKey, msg);

  // Decrypt succeeded — commit the snapshot back to the live state.
  state.rootKey                   = snap.rootKey;
  state.sendingChainKey           = snap.sendingChainKey;
  state.receivingChainKey         = newChain;
  state.sendingRatchetKeyPair     = snap.sendingRatchetKeyPair;
  state.receivingRatchetPublic    = snap.receivingRatchetPublic;
  state.sendingNumber             = snap.sendingNumber;
  state.receivingNumber           = snap.receivingNumber + 1;
  state.previousReceivingChainKey = snap.previousReceivingChainKey;
  state.previousSendingNumber     = snap.previousSendingNumber;
  state.chainCounters             = snap.chainCounters;
  commitSkipped(state, added, null);

  return new TextDecoder().decode(plaintext);
}
