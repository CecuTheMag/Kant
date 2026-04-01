/**
 * Kant Identity — keypair generation, Argon2id password derivation, IndexedDB storage
 */
export interface StoredKeypair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    publicKeyHex: string;
}
export declare function hasIdentity(): Promise<boolean>;
export declare function createIdentity(password: string): Promise<StoredKeypair>;
export declare function unlockIdentity(password: string): Promise<StoredKeypair | null>;
export declare function wipeIdentity(): Promise<void>;
