/**
 * Kant Core — Crypto & P2P primitives (Phase 0)
 */
import { type Libp2p } from 'libp2p';
export { hasIdentity, createIdentity, unlockIdentity, wipeIdentity } from './identity.js';
export type { StoredKeypair } from './identity.js';
export { generateX25519Keypair, ed25519ToX25519, x3dhSend, x3dhReceive, initSenderRatchet, initReceiverRatchet, ratchetEncrypt, ratchetDecrypt } from './ratchet.js';
export type { X25519Keypair, X3DHPublicBundle, X3DHPrivateBundle, RatchetState, EncryptedMessage } from './ratchet.js';
export { fetchPreKeyBundle, buildPrivateBundle, buildPublicBundle, getOrCreateSPK, PREKEY_PROTOCOL } from './prekey.js';
export declare const PING_PROTOCOL = "/kant/ping/1.0.0";
export interface Keypair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    publicKeyHex: string;
}
export declare function generateKeypair(_password: string): Promise<Keypair>;
export type PingHandler = (fromPeerId: string, message: string) => void;
import type { StoredKeypair } from './identity.js';
export declare function createNode(onPing?: PingHandler, relayAddr?: string, identity?: StoredKeypair): Promise<Libp2p>;
export declare function connectToRelay(node: Libp2p, relayMultiaddr: string): Promise<void>;
export declare function sendPing(node: Libp2p, peerMultiaddr: string, message: string): Promise<string>;
export declare function ping(): string;
