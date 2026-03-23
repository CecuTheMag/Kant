/**
 * Kant Core - Crypto & P2P primitives (Phase 0)
 */

import sodium from 'libsodium-wrappers';

/**
 * Generate Ed25519 keypair for user identity.
 * Private key encrypted with Argon2id-derived key from app password.
 */
export async function generateKeypair(_password: string): Promise<any> {
  await sodium.ready;
  
  const keyPair = sodium.crypto_sign_keypair();
  
  console.log('Ed25519 keypair generated');
  console.log('Public key (identity):', sodium.to_hex(keyPair.publicKey));
  
  // TODO: Argon2id password => encryption key => encrypt private key
  // Store in IndexedDB
  
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey
  } as any; // Simplified for Phase 0
}

// Phase 0 milestone ping
export function ping(): string {
  return 'Kant Phase 0: P2P crypto foundation ready';
}
