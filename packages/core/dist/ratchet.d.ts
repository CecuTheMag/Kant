/**
 * Kant Ratchet — X3DH key exchange + Double Ratchet encryption
 *
 * Uses libsodium primitives:
 *   - X25519 (crypto_scalarmult) for DH
 *   - HKDF via crypto_kdf for key derivation
 *   - XSalsa20-Poly1305 (crypto_secretbox) for message encryption
 *   - Ed25519 identity keys converted to X25519 for DH
 */
export interface X25519Keypair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}
export interface RatchetState {
    rootKey: Uint8Array;
    sendChainKey: Uint8Array;
    sendMsgNum: number;
    recvChainKey: Uint8Array;
    recvMsgNum: number;
    dhSendKeypair: X25519Keypair;
    dhRecvPublic: Uint8Array | null;
    skipped: Map<string, Uint8Array>;
}
export interface EncryptedMessage {
    header: {
        dhPublic: Uint8Array;
        msgNum: number;
        prevChainLen: number;
    };
    ciphertext: Uint8Array;
    nonce: Uint8Array;
}
export declare function generateX25519Keypair(): Promise<X25519Keypair>;
/** Convert Ed25519 keypair to X25519 for use in DH */
export declare function ed25519ToX25519(edPublic: Uint8Array, edPrivate: Uint8Array): Promise<X25519Keypair>;
export interface X3DHPublicBundle {
    identityKey: Uint8Array;
    signedPreKey: Uint8Array;
    oneTimePreKey?: Uint8Array;
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
export declare function x3dhSend(aliceIdentity: X25519Keypair, bobBundle: X3DHPublicBundle): Promise<{
    sharedSecret: Uint8Array;
    ephemeralPublic: Uint8Array;
}>;
/**
 * X3DH receiver side — Bob derives the same shared secret from Alice's ephemeral key.
 */
export declare function x3dhReceive(bobBundle: X3DHPrivateBundle, aliceIdentityPublic: Uint8Array, aliceEphemeralPublic: Uint8Array): Promise<Uint8Array>;
/**
 * Initialise ratchet state for the SENDER (Alice).
 * Called after X3DH with the shared secret and Bob's signed pre-key public.
 */
export declare function initSenderRatchet(sharedSecret: Uint8Array, bobSignedPreKeyPublic: Uint8Array): Promise<RatchetState>;
/**
 * Initialise ratchet state for the RECEIVER (Bob).
 * Called after X3DH with the shared secret and Bob's signed pre-key pair.
 */
export declare function initReceiverRatchet(sharedSecret: Uint8Array, bobSignedPreKeypair: X25519Keypair): Promise<RatchetState>;
/** Encrypt a message, advancing the sending chain */
export declare function ratchetEncrypt(state: RatchetState, plaintext: string): Promise<EncryptedMessage>;
/** Decrypt a message, performing DH ratchet step if needed */
export declare function ratchetDecrypt(state: RatchetState, msg: EncryptedMessage): Promise<string>;
