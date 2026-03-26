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
const getSubtle = () => globalThis.crypto.subtle;
// ── KDF helpers (SubtleCrypto HKDF — available in Node 18+ and browsers) ─────
async function hmac(key, data) {
    const k = await getSubtle().importKey('raw', key.buffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await getSubtle().sign('HMAC', k, data.buffer));
}
async function hkdf(inputKey, salt, info, len) {
    const prk = await hmac(salt, inputKey);
    const infoBytes = new TextEncoder().encode(info);
    const t1Input = new Uint8Array(infoBytes.length + 1);
    t1Input.set(infoBytes);
    t1Input[infoBytes.length] = 0x01;
    const t1 = await hmac(prk, t1Input);
    if (len <= 32)
        return t1.slice(0, len);
    const t2Input = new Uint8Array(32 + infoBytes.length + 1);
    t2Input.set(t1);
    t2Input.set(infoBytes, 32);
    t2Input[32 + infoBytes.length] = 0x02;
    const t2 = await hmac(prk, t2Input);
    const out = new Uint8Array(len);
    out.set(t1.slice(0, Math.min(32, len)));
    if (len > 32)
        out.set(t2.slice(0, len - 32), 32);
    return out;
}
/** KDF_RK: derive new root key and chain key from root key + DH output */
async function kdfRootKey(rootKey, dhOut) {
    const out = await hkdf(dhOut, rootKey, 'kant-root-ratchet', 64);
    return [out.slice(0, 32), out.slice(32, 64)];
}
/** KDF_CK: derive message key and next chain key from chain key */
async function kdfChainKey(chainKey) {
    const msgKey = await hmac(chainKey, new Uint8Array([0x01]));
    const nextChain = await hmac(chainKey, new Uint8Array([0x02]));
    return [msgKey, nextChain];
}
// ── X25519 DH ────────────────────────────────────────────────────────────────
export async function generateX25519Keypair() {
    await sodium.ready;
    const kp = sodium.crypto_box_keypair();
    return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}
/** Convert Ed25519 keypair to X25519 for use in DH */
export async function ed25519ToX25519(edPublic, edPrivate) {
    await sodium.ready;
    return {
        publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(edPublic),
        privateKey: sodium.crypto_sign_ed25519_sk_to_curve25519(edPrivate)
    };
}
function dh(myPrivate, theirPublic) {
    return sodium.crypto_scalarmult(myPrivate, theirPublic);
}
/**
 * X3DH sender side — Alice initiates a session with Bob.
 * Returns the shared secret and the ephemeral public key to send to Bob.
 */
export async function x3dhSend(aliceIdentity, bobBundle) {
    await sodium.ready;
    const ephemeral = await generateX25519Keypair();
    const dh1 = dh(aliceIdentity.privateKey, bobBundle.signedPreKey); // DH(IK_A, SPK_B)
    const dh2 = dh(ephemeral.privateKey, bobBundle.identityKey); // DH(EK_A, IK_B)
    const dh3 = dh(ephemeral.privateKey, bobBundle.signedPreKey); // DH(EK_A, SPK_B)
    const dhConcat = bobBundle.oneTimePreKey
        ? concat(dh1, dh2, dh3, dh(ephemeral.privateKey, bobBundle.oneTimePreKey))
        : concat(dh1, dh2, dh3);
    const sharedSecret = await hkdf(dhConcat, new Uint8Array(32), // zero salt
    'kant-x3dh', 32);
    return { sharedSecret, ephemeralPublic: ephemeral.publicKey };
}
/**
 * X3DH receiver side — Bob derives the same shared secret from Alice's ephemeral key.
 */
export async function x3dhReceive(bobBundle, aliceIdentityPublic, aliceEphemeralPublic) {
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
export async function initSenderRatchet(sharedSecret, bobSignedPreKeyPublic) {
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
export async function initReceiverRatchet(sharedSecret, bobSignedPreKeypair) {
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
export async function ratchetEncrypt(state, plaintext) {
    await sodium.ready;
    const [msgKey, nextChainKey] = await kdfChainKey(state.sendChainKey);
    state.sendChainKey = nextChainKey;
    const msgNum = state.sendMsgNum++;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(new TextEncoder().encode(plaintext), nonce, msgKey);
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
export async function ratchetDecrypt(state, msg) {
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
async function skipMessageKeys(state, until) {
    const MAX_SKIP = 100;
    while (state.recvMsgNum < until) {
        if (state.recvMsgNum >= MAX_SKIP)
            break;
        const [msgKey, nextChainKey] = await kdfChainKey(state.recvChainKey);
        state.recvChainKey = nextChainKey;
        const key = `${state.dhRecvPublic ? sodium.to_hex(state.dhRecvPublic) : 'null'}:${state.recvMsgNum}`;
        state.skipped.set(key, msgKey);
        state.recvMsgNum++;
    }
}
function decrypt(msgKey, msg) {
    const plaintext = sodium.crypto_secretbox_open_easy(msg.ciphertext, msg.nonce, msgKey);
    return new TextDecoder().decode(plaintext);
}
// ── Utils ─────────────────────────────────────────────────────────────────────
function concat(...arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
        out.set(a, offset);
        offset += a.length;
    }
    return out;
}
