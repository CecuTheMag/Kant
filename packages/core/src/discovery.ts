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
export function startDiscovery(node: Libp2p, onPeer: PeerDiscoveryHandler): () => void {
  const seen = new Set<string>();

  function handleConnect(event: CustomEvent<{ detail: { remotePeer: { toString(): string } } }>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peerId = (event as any).detail.toString();
    if (seen.has(peerId)) return;
    seen.add(peerId);

    // Give identify a moment to populate multiaddrs
    setTimeout(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const peerInfo = (node as any).peerStore?.get?.(peerId);
        const addrs: string[] = peerInfo?.addresses?.map((a: { multiaddr: { toString(): string } }) => a.multiaddr.toString()) ?? [];
        const circuit = addrs.filter(a => a.includes('/p2p-circuit'));
        if (circuit.length > 0) {
          console.log('[discovery] peer found:', peerId.slice(0, 20), circuit[0]);
          onPeer({ peerId, multiaddrs: circuit });
        }
      } catch (e) {
        console.warn('[discovery] peerStore lookup failed:', e);
      }
    }, 1500);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (node as any).addEventListener('peer:connect', handleConnect);
  console.log('[discovery] listening for peers');

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node as any).removeEventListener('peer:connect', handleConnect);
  };
}

/**
 * Get all currently known peers with circuit addresses from the peer store.
 */
export function getKnownPeers(node: Libp2p): DiscoveredPeer[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peers = (node as any).peerStore?.all?.() ?? [];
    return peers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({
        peerId: p.id.toString(),
        multiaddrs: (p.addresses ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => a.multiaddr.toString())
          .filter((a: string) => a.includes('/p2p-circuit'))
      }))
      .filter((p: DiscoveredPeer) => p.multiaddrs.length > 0);
  } catch {
    return [];
  }
}
