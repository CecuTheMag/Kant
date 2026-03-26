/**
 * Kant Ratchet — X3DH key exchange + Double Ratchet encryption
 *
 * Uses libsodium primitives:
 *   - X25519 (crypto_scalarmult) for DH
 *   - HKDF via crypto_kdf for key derivation
 *   - XSalsa20-Poly1305 (crypto_secretbox) for message encryption
 *   - Ed25519 identity keys converted to X25519 for DH
 */

import sodium from 'libsodium-wrappers';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSubtle = (): SubtleCrypto => (globalThis as any).crypto.subtle;

export interface X25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface RatchetState {
  // Root key
  rootKey: Uint8Array;
  // Sending chain
  sendChainKey: Uint8Array;
  sendMsgNum: number;
  // Receiving chain
  recvChainKey: Uint8Array;
  recvMsgNum: number;
  // DH ratchet keys
  dhSendKeypair: X25519Keypair;
  dhRecvPublic: Uint8Array | null;
  // Skipped message keys (for out-of-order delivery)
  skipped: Map<string, Uint8Array>;
}

export interface EncryptedMessage {
  header: {
    dhPublic: Uint8Array;  // sender's current DH ratchet public key
    msgNum: number;
    prevChainLen: number;
  };
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

// ── KDF helpers (SubtleCrypto HKDF — available in Node 18+ and browsers) ─────

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await getSubtle().importKey('raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await getSubtle().sign('HMAC', k, data.buffer as ArrayBuffer));
}

async function hkdf(inputKey: Uint8Array, salt: Uint8Array, info: string, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, inputKey);
  const infoBytes = new TextEncoder().encode(info);
  const t1Input = new Uint8Array(infoBytes.length + 1);
  t1Input.set(infoBytes); t1Input[infoBytes.length] = 0x01;
  const t1 = await hmac(prk, t1Input);
  if (len <= 32) return t1.slice(0, len);
  const t2Input = new Uint8Array(32 + infoBytes.length + 1);
  t2Input.set(t1); t2Input.set(infoBytes, 32); t2Input[32 + infoBytes.length] = 0x02;
  const t2 = await hmac(prk, t2Input);
  const out = new Uint8Array(len);
  out.set(t1.slice(0, Math.min(32, len)));
  if (len > 32) out.set(t2.slice(0, len - 32), 32);
  return out;
}

/** KDF_RK: derive new root key and chain key from root key + DH output */
async function kdfRootKey(rootKey: Uint8Array, dhOut: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdf(dhOut, rootKey, 'kant-root-ratchet', 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

/** KDF_CK: derive message key and next chain key from chain key */
async function kdfChainKey(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const msgKey = await hmac(chainKey, new Uint8Array([0x01]));
  const nextChain = await hmac(chainKey, new Uint8Array([0x02]));
  return [msgKey, nextChain];
}

// ── X25519 DH ────────────────────────────────────────────────────────────────

export async function generateX25519Keypair(): Promise<X25519Keypair> {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Convert Ed25519 keypair to X25519 for use in DH */
export async function ed25519ToX25519(
  edPublic: Uint8Array,
  edPrivate: Uint8Array
): Promise<X25519Keypair> {
  await sodium.ready;
  return {
    publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(edPublic),
    privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(edPrivate)
  };
}

function dh(myPrivate: Uint8Array, theirPublic: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult(myPrivate, theirPublic);
}

// ── X3DH Initial Key Exchange ─────────────────────────────────────────────────

export interface X3DHPublicBundle {
  identityKey: Uint8Array;   // IK_B (X25519)
  signedPreKey: Uint8Array;  // SPK_B (X25519)
  oneTimePreKey?: Uint8Array; // OPK_B (X25519, optional)
}

export interface X3DHPrivateBundle {
  identityKeypair: X25519Keypair;
  signedPreKeypair: X25519Keypair;
  oneTimePreKeypair?: X25519Keypair;
}

/**
 * X3DH sender side — Alice initiates a session with Bob.
 * Returns the shared secret and the ephemeral public key to send to Bob.
 */
export async function x3dhSend(
  aliceIdentity: X25519Keypair,
  bobBundle: X3DHPublicBundle
): Promise<{ sharedSecret: Uint8Array; ephemeralPublic: Uint8Array }> {
  await sodium.ready;
  const ephemeral = await generateX25519Keypair();

  const dh1 = dh(aliceIdentity.privateKey, bobBundle.signedPreKey);   // DH(IK_A, SPK_B)
  const dh2 = dh(ephemeral.privateKey, bobBundle.identityKey);         // DH(EK_A, IK_B)
  const dh3 = dh(ephemeral.privateKey, bobBundle.signedPreKey);        // DH(EK_A, SPK_B)

  const dhConcat = bobBundle.oneTimePreKey
    ? concat(dh1, dh2, dh3, dh(ephemeral.privateKey, bobBundle.oneTimePreKey))
    : concat(dh1, dh2, dh3);

  const sharedSecret = await hkdf(
    dhConcat,
    new Uint8Array(32), // zero salt
    'kant-x3dh',
    32
  );

  return { sharedSecret, ephemeralPublic: ephemeral.publicKey };
}

/**
 * X3DH receiver side — Bob derives the same shared secret from Alice's ephemeral key.
 */
export async function x3dhReceive(
  bobBundle: X3DHPrivateBundle,
  aliceIdentityPublic: Uint8Array,
  aliceEphemeralPublic: Uint8Array
): Promise<Uint8Array> {
  await sodium.ready;
  const dh1 = dh(bobBundle.signedPreKeypair.privateKey, aliceIdentityPublic);
  const dh2 = dh(bobBundle.identityKeypair.privateKey, aliceEphemeralPublic);
  const dh3 = dh(bobBundle.signedPreKeypair.privateKey, aliceEphemeralPublic);

  const dhConcat = bobBundle.oneTimePreKeypair
    ? concat(dh1, dh2, dh3, dh(bobBundle.oneTimePreKeypair.privateKey, aliceEphemeralPublic))
    : concat(dh1, dh2, dh3);

  return hkdf(dhConcat, new Uint8Array(32), 'kant-x3dh', 32);
}

// ── Double Ratchet ────────────────────────────────────────────────────────────

/**
 * Initialise ratchet state for the SENDER (Alice).
 * Called after X3DH with the shared secret and Bob's signed pre-key public.
 */
export async function initSenderRatchet(
  sharedSecret: Uint8Array,
  bobSignedPreKeyPublic: Uint8Array
): Promise<RatchetState> {
  await sodium.ready;
  const dhSendKeypair = await generateX25519Keypair();
  const dhOut = dh(dhSendKeypair.privateKey, bobSignedPreKeyPublic);
  const [rootKey, sendChainKey] = await kdfRootKey(sharedSecret, dhOut);

  return {
    rootKey,
    sendChainKey,
    sendMsgNum: 0,
    recvChainKey: new Uint8Array(32),
    recvMsgNum: 0,
    dhSendKeypair,
    dhRecvPublic: bobSignedPreKeyPublic,
    skipped: new Map()
  };
}

/**
 * Initialise ratchet state for the RECEIVER (Bob).
 * Called after X3DH with the shared secret and Bob's signed pre-key pair.
 */
export async function initReceiverRatchet(
  sharedSecret: Uint8Array,
  bobSignedPreKeypair: X25519Keypair
): Promise<RatchetState> {
  return {
    rootKey: sharedSecret,
    sendChainKey: new Uint8Array(32),
    sendMsgNum: 0,
    recvChainKey: new Uint8Array(32),
    recvMsgNum: 0,
    dhSendKeypair: bobSignedPreKeypair,
    dhRecvPublic: null,
    skipped: new Map()
  };
}

/** Encrypt a message, advancing the sending chain */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string
): Promise<EncryptedMessage> {
  await sodium.ready;
  const [msgKey, nextChainKey] = await kdfChainKey(state.sendChainKey);
  state.sendChainKey = nextChainKey;
  const msgNum = state.sendMsgNum++;

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    new TextEncoder().encode(plaintext),
    nonce,
    msgKey
  );

  return {
    header: {
      dhPublic: state.dhSendKeypair.publicKey,
      msgNum,
      prevChainLen: 0
    },
    ciphertext,
    nonce
  };
}

/** Decrypt a message, performing DH ratchet step if needed */
export async function ratchetDecrypt(
  state: RatchetState,
  msg: EncryptedMessage
): Promise<string> {
  await sodium.ready;

  // Check skipped keys first
  const skipKey = `${sodium.to_hex(msg.header.dhPublic)}:${msg.header.msgNum}`;
  const skippedMsgKey = state.skipped.get(skipKey);
  if (skippedMsgKey) {
    state.skipped.delete(skipKey);
    return decrypt(skippedMsgKey, msg);
  }

  const dhPublicHex = sodium.to_hex(msg.header.dhPublic);
  const currentDhHex = state.dhRecvPublic ? sodium.to_hex(state.dhRecvPublic) : null;

  // DH ratchet step if new DH public key
  if (dhPublicHex !== currentDhHex) {
    // Skip any remaining messages in current receiving chain
    await skipMessageKeys(state, msg.header.prevChainLen);

    // Perform DH ratchet
    state.dhRecvPublic = msg.header.dhPublic;
    const dhOut1 = dh(state.dhSendKeypair.privateKey, state.dhRecvPublic);
    const [rootKey1, recvChainKey] = await kdfRootKey(state.rootKey, dhOut1);

    // Generate new sending keypair
    state.dhSendKeypair = await generateX25519Keypair();
    const dhOut2 = dh(state.dhSendKeypair.privateKey, state.dhRecvPublic);
    const [rootKey2, sendChainKey] = await kdfRootKey(rootKey1, dhOut2);

    state.rootKey = rootKey2;
    state.recvChainKey = recvChainKey;
    state.sendChainKey = sendChainKey;
    state.recvMsgNum = 0;
    state.sendMsgNum = 0;
  }

  await skipMessageKeys(state, msg.header.msgNum);
  const [msgKey, nextChainKey] = await kdfChainKey(state.recvChainKey);
  state.recvChainKey = nextChainKey;
  state.recvMsgNum++;

  return decrypt(msgKey, msg);
}

async function skipMessageKeys(state: RatchetState, until: number): Promise<void> {
  const MAX_SKIP = 100;
  while (state.recvMsgNum < until) {
    if (state.recvMsgNum >= MAX_SKIP) break;
    const [msgKey, nextChainKey] = await kdfChainKey(state.recvChainKey);
    state.recvChainKey = nextChainKey;
    const key = `${state.dhRecvPublic ? sodium.to_hex(state.dhRecvPublic) : 'null'}:${state.recvMsgNum}`;
    state.skipped.set(key, msgKey);
    state.recvMsgNum++;
  }
}

function decrypt(msgKey: Uint8Array, msg: EncryptedMessage): string {
  const plaintext = sodium.crypto_secretbox_open_easy(msg.ciphertext, msg.nonce, msgKey);
  return new TextDecoder().decode(plaintext);
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}
