/**
 * Kant Ratchet — X3DH key exchange + Double Ratchet encryption
 */
import { getSodium } from './sodium';
export async function generateX25519Keypair() {
    const sodium = await getSodium();
    const kp = sodium.crypto_kx_keypair();
    return {
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
    };
}
export async function ed25519ToX25519(publicKey, privateKey) {
    const sodium = await getSodium();
    const xPublicKey = sodium.crypto_sign_ed25519_pk_to_curve25519(publicKey);
    const xPrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(privateKey);
    return {
        publicKey: xPublicKey,
        privateKey: xPrivateKey,
    };
}
async function kdf(sodium, inputKey, context) {
    const output = new Uint8Array(64);
    sodium.crypto_kdf_derive_from_key(output, 32, 1, context, inputKey);
    sodium.crypto_kdf_derive_from_key(output, 32, 2, context, inputKey);
    return [
        output.slice(0, 32),
        output.slice(32)
    ];
}
export async function x3dhSend(publicBundle, ephemeralKp) {
    const sodium = await getSodium();
    // DH1 = ephemeralPriv * identityPub
    const dh1 = sodium.crypto_scalarmult_curve25519(ephemeralKp.privateKey, publicBundle.identityKey);
    // DH2 = ephemeralPriv * signedPrePub
    const dh2 = sodium.crypto_scalarmult_curve25519(ephemeralKp.privateKey, publicBundle.signedPreKey);
    // DH3 = ephemeralPub * identityPriv (done on receiver)
    // DH4 = ephemeralPub * signedPrePriv (done on receiver)
    // Shared secret K = HKDF(DH1 || DH2 || DH3 || DH4)[0:32]
    const kdfInput = new Uint8Array(dh1.length + dh2.length);
    kdfInput.set(dh1);
    kdfInput.set(dh2, dh1.length);
    const [sharedSecret] = await kdf(sodium, kdfInput, 'x3dh');
    return sharedSecret;
}
export async function x3dhReceive(privateBundle, ephemeralPub) {
    const sodium = await getSodium();
    // DH1 = ephemeralPriv * identityPub (sender side)
    // DH2 = ephemeralPriv * signedPrePub (sender side)
    // DH3 = identityPriv * ephemeralPub
    const dh3 = sodium.crypto_scalarmult_curve25519(privateBundle.identityKeypair.privateKey, ephemeralPub);
    // DH4 = signedPrePriv * ephemeralPub
    const dh4 = sodium.crypto_scalarmult_curve25519(privateBundle.signedPreKeypair.privateKey, ephemeralPub);
    // K = HKDF(DH1 || DH2 || DH3 || DH4)[0:32]
    const kdfInput = new Uint8Array(dh3.length + dh4.length);
    kdfInput.set(dh3);
    kdfInput.set(dh4, dh3.length);
    const [sharedSecret] = await kdf(sodium, kdfInput, 'x3dh');
    return sharedSecret;
}
export async function initSenderRatchet(sharedSecret, bobSignedPrePublic) {
    const sodium = await getSodium();
    const [rootKey, chainKey] = await kdf(sodium, sharedSecret, 'ratchet-sender');
    const sendingRatchetKeyPair = await generateX25519Keypair();
    const receivingRatchetPublic = bobSignedPrePublic;
    return {
        rootKey,
        sendingChainKey: chainKey,
        receivingChainKey: new Uint8Array(32), // initial
        sendingRatchetKeyPair: sendingRatchetKeyPair,
        receivingRatchetPublic,
        sendingNumber: 0,
        receivingNumber: 0,
        previousReceivingChainKey: null,
    };
}
export async function initReceiverRatchet(sharedSecret, signedPreKeyPair) {
    const sodium = await getSodium();
    const [rootKey, chainKey] = await kdf(sodium, sharedSecret, 'ratchet-receiver');
    return {
        rootKey,
        sendingChainKey: new Uint8Array(32), // initial
        receivingChainKey: chainKey,
        sendingRatchetKeyPair: signedPreKeyPair,
        receivingRatchetPublic: signedPreKeyPair.publicKey,
        sendingNumber: 0,
        receivingNumber: 0,
        previousReceivingChainKey: null,
    };
}
async function hkdfChain(sodium, chainKey, context) {
    const output = new Uint8Array(64);
    sodium.crypto_kdf_derive_from_key(output, 32, 1, context, chainKey); // messageKey
    const newChainKey = sodium.crypto_kdf_derive_from_key(new Uint8Array(32), 32, 2, context, chainKey); // chainKey
    return [output.slice(0, 32), newChainKey];
}
async function dhRatchetStep(sodium, state, theirPub) {
    // Advance root
    const [newRootKey, sendingChainKey] = await kdf(sodium, sodium.crypto_scalarmult_curve25519(state.sendingRatchetKeyPair.privateKey, theirPub), 'root-ratchet');
    // New sending chain
    state.rootKey = newRootKey;
    state.sendingChainKey = sendingChainKey;
    state.sendingRatchetKeyPair = await generateX25519Keypair();
    state.receivingRatchetPublic = theirPub;
    state.sendingNumber = 0;
}
export async function ratchetEncrypt(state, plaintext) {
    const sodium = await getSodium();
    const [messageKey, newSendingChainKey] = await hkdfChain(sodium, state.sendingChainKey, 'send-msg');
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_npubbytes());
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintextBytes, null, null, nonce, messageKey);
    state.sendingChainKey = newSendingChainKey;
    state.sendingNumber++;
    return {
        ciphertext,
        ephemeralPublicKey: state.sendingRatchetKeyPair.publicKey,
    };
}
export async function ratchetDecrypt(state, msg) {
    const sodium = await getSodium();
    // Try current receiving chain
    let [messageKey] = await hkdfChain(sodium, state.receivingChainKey, 'recv-msg');
    let nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_npubbytes()); // Header has nonce? Simplified
    let plaintext;
    try {
        plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(msg.ciphertext, null, null, nonce, // assume included
        messageKey);
    }
    catch {
        // Ratchet step if header DH mismatch
        await dhRatchetStep(sodium, state, msg.ephemeralPublicKey);
        [messageKey] = await hkdfChain(sodium, state.receivingChainKey, 'recv-msg');
        plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(msg.ciphertext, null, null, nonce, messageKey);
    }
    state.receivingNumber++;
    return new TextDecoder().decode(plaintext);
}
