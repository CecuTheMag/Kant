/**
 * Kant Queue — Offline message queue with retry on peer:connect
 */
import type { Libp2p } from 'libp2p';
export interface QueuedMessage {
    id: string;
    contactPubkeyHex: string;
    peerCircuitAddr: string;
    wirePayload: string;
    timestamp: number;
    retries: number;
}
export declare function enqueue(msg: Omit<QueuedMessage, 'retries'>): Promise<void>;
export declare function dequeue(id: string): Promise<void>;
export declare function getPendingForContact(contactPubkeyHex: string): Promise<QueuedMessage[]>;
export type SendFn = (wirePayload: string, peerCircuitAddr: string) => Promise<void>;
/**
 * Listen for peer:connect events and flush queued messages for that peer.
 * Returns cleanup function.
 */
export declare function startQueueRetry(node: Libp2p, peerToContact: Map<string, string>, send: SendFn, onDelivered: (msgId: string) => void): () => void;
