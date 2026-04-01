/**
 * Kant Pre-Key Bundle — serve and fetch X3DH public bundles over P2P
 *
 * Protocol: /kant/prekey/1.0.0
 * Request:  empty (just open stream)
 * Response: JSON { identityKey: number[], signedPreKey: number[] }
 */
import type { X25519Keypair, X3DHPublicBundle, X3DHPrivateBundle } from './ratchet';
import type { StoredKeypair } from './identity.js';
import type { Libp2p } from 'libp2p';
export declare const PREKEY_PROTOCOL = "/kant/prekey/1.0.0";
/** Get or create the local signed pre-key, persisted in IndexedDB */
export declare function getOrCreateSPK(): Promise<X25519Keypair>;
/** Build the full private bundle for X3DH receive side */
export declare function buildPrivateBundle(identity: StoredKeypair): Promise<X3DHPrivateBundle>;
/** Build the public bundle to send to a peer */
export declare function buildPublicBundle(identity: StoredKeypair): Promise<X3DHPublicBundle>;
/** Register the prekey protocol handler on a node */
export declare function registerPrekeyHandler(node: Libp2p, identity: StoredKeypair): Promise<void>;
/** Fetch a peer's X3DH public bundle over the prekey protocol */
export declare function fetchPreKeyBundle(node: Libp2p, peerCircuitAddr: string): Promise<X3DHPublicBundle>;
