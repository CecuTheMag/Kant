/**
 * Kant Core - Crypto & P2P primitives (Phase 0)
 */
/**
 * Generate Ed25519 keypair for user identity.
 * Private key encrypted with Argon2id-derived key from app password.
 */
export declare function generateKeypair(_password: string): Promise<any>;
export declare function ping(): string;
