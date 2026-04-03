/**
 * Kant Discovery — DHT-based peer discovery via relay bootstrap
 *
 * Strategy: use libp2p's built-in peer store + peer:connect events.
 * We advertise ourselves by connecting to the relay (which gossips our
 * PeerInfo to other connected peers via identify push), then listen for
 * peer:connect to surface newly discovered peers to the UI.
 *
 * Full kad-dht requires a separate npm install; this lightweight approach
 * works with the existing libp2p 3.x setup and zero new dependencies.
 */
import type { Libp2p } from 'libp2p';
export interface DiscoveredPeer {
    peerId: string;
    multiaddrs: string[];
}
export type PeerDiscoveryHandler = (peer: DiscoveredPeer) => void;
/**
 * Start passive peer discovery: listen for peer:connect events and
 * surface any peer that has circuit-relay multiaddrs (i.e. reachable peers).
 * Returns a cleanup function.
 */
export declare function startDiscovery(node: Libp2p, onPeer: PeerDiscoveryHandler): () => void;
/**
 * Get all currently known peers with circuit addresses from the peer store.
 */
export declare function getKnownPeers(node: Libp2p): DiscoveredPeer[];
