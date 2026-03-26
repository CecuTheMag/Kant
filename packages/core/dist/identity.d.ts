/**
 * Kant Identity — keypair generation, Argon2id password derivation, IndexedDB storage
 */
export interface StoredKeypair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    publicKeyHex: string;
}
/** Check if a keypair exists in IndexedDB */
export declare function hasIdentity(): Promise<boolean>;
/**
 * Create a new Ed25519 keypair, encrypt the private key with Argon2id(password),
 * and store in IndexedDB. Throws if identity already exists.
 */
export declare function createIdentity(password: string): Promise<StoredKeypair>;
/**
 * Unlock the stored keypair with the given password.
 * Returns null if password is wrong.
 */
export declare function unlockIdentity(password: string): Promise<StoredKeypair | null>;
/** Wipe all identity data from IndexedDB */
export declare function wipeIdentity(): Promise<void>;
