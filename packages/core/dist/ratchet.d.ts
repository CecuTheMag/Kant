/**
 * Kant Ratchet — X3DH key exchange + Double Ratchet encryption
 */
export interface X25519Keypair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}
export interface X3DHPublicBundle {
    identityKey: Uint8Array;
    signedPreKey: Uint8Array;
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
export declare function generateX25519Keypair(): Promise<X25519Keypair>;
export declare function ed25519ToX25519(publicKey: Uint8Array, privateKey: Uint8Array): Promise<X25519Keypair>;
export declare function x3dhSend(myX25519: X25519Keypair, publicBundle: X3DHPublicBundle): Promise<{
    sharedSecret: Uint8Array;
    ephemeralPublic: Uint8Array;
}>;
export declare function x3dhReceive(privateBundle: X3DHPrivateBundle, ephemeralPub: Uint8Array): Promise<Uint8Array>;
export declare function initSenderRatchet(sharedSecret: Uint8Array, bobSignedPrePublic: Uint8Array): Promise<RatchetState>;
export declare function initReceiverRatchet(sharedSecret: Uint8Array, signedPreKeyPair: X25519Keypair): Promise<RatchetState>;
export declare function ratchetEncrypt(state: RatchetState, plaintext: string): Promise<EncryptedMessage>;
export declare function ratchetDecrypt(state: RatchetState, msg: EncryptedMessage): Promise<string>;
