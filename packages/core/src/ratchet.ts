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
  receivingNumber: number;
  previousReceivingChainKey: Uint8Array | null;
}

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
  state.sendingNumber = 0;
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
    header: { dhPublic: state.sendingRatchetKeyPair.publicKey, msgNum, prevChainLen: 0 },
    ephemeralPublicKey: state.sendingRatchetKeyPair.publicKey,
  };
}

export async function ratchetDecrypt(state: RatchetState, msg: EncryptedMessage): Promise<string> {
  const sodium = await getSodium();
  const dhPublic = msg.header?.dhPublic ?? msg.ephemeralPublicKey;
  const nonce = msg.nonce;

  // Check if sender has ratcheted (new DH public key)
  const isNewDH = !state.receivingRatchetPublic ||
    dhPublic.length !== state.receivingRatchetPublic.length ||
    !dhPublic.every((b, i) => b === state.receivingRatchetPublic[i]);

  // Work on a snapshot so we never permanently mutate state on a failed
  // decrypt attempt.  The "try all ratchets" loop in the message handler
  // calls this function on every known ratchet until one succeeds — a failed
  // attempt must leave the ratchet state completely untouched.
  const snap: RatchetState = {
    rootKey:                   state.rootKey,
    sendingChainKey:           state.sendingChainKey,
    receivingChainKey:         state.receivingChainKey,
    sendingRatchetKeyPair:     state.sendingRatchetKeyPair,
    receivingRatchetPublic:    state.receivingRatchetPublic,
    sendingNumber:             state.sendingNumber,
    receivingNumber:           state.receivingNumber,
    previousReceivingChainKey: state.previousReceivingChainKey,
  };

  if (isNewDH) {
    await dhRatchetStep(sodium, snap, dhPublic);
  }

  const [messageKey, newChain] = await hkdfChain(sodium, snap.receivingChainKey, 'send-msg');

  // This throws if the key is wrong — snap is discarded, state is untouched.
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, msg.ciphertext, null, nonce, messageKey
  );

  // Decrypt succeeded — commit the snapshot back to the live state.
  state.rootKey                   = snap.rootKey;
  state.sendingChainKey           = snap.sendingChainKey;
  state.receivingChainKey         = newChain;
  state.sendingRatchetKeyPair     = snap.sendingRatchetKeyPair;
  state.receivingRatchetPublic    = snap.receivingRatchetPublic;
  state.sendingNumber             = snap.sendingNumber;
  state.receivingNumber           = snap.receivingNumber + 1;
  state.previousReceivingChainKey = snap.previousReceivingChainKey;

  return new TextDecoder().decode(plaintext);
}
