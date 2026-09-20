/**
 * Kant Discovery — passive peer discovery via relay bootstrap
 *
 * Strategy: use libp2p's built-in peer store + peer:connect events.
 * We advertise ourselves by connecting to the relay (which gossips our
 * PeerInfo to other connected peers via identify push), then listen for
 * peer:connect to surface newly discovered peers to the UI.
 */

import type { Libp2p } from 'libp2p';
import { peerIdFromString } from '@libp2p/peer-id';

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

  function handleConnect(event: CustomEvent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peerId = (event as any).detail?.toString?.();
    if (!peerId || seen.has(peerId)) return;
    seen.add(peerId);

    // Retry peer store lookup up to 3 times with 2s gaps.
    // On a congested relay link, identify can take longer than 1.5s to
    // populate multiaddrs — a single attempt would silently miss the peer.
    const tryLookup = async (attempt: number): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const peerInfo = await (node as any).peerStore?.get?.(peerIdFromString(peerId));
        const addrs: string[] = peerInfo?.addresses?.map((a: { multiaddr: { toString(): string } }) => a.multiaddr.toString()) ?? [];
        const circuit = addrs.filter((a: string) => a.includes('/p2p-circuit'));
        if (circuit.length > 0) {
          // Sanitize peerId before logging (it's a libp2p PeerID, safe, but be explicit)
          console.log('[discovery] peer found:', peerId.replace(/[^\w]/g, '').slice(0, 20), circuit[0].slice(0, 80));
          onPeer({ peerId, multiaddrs: circuit });
        } else if (attempt < 3) {
          setTimeout(() => tryLookup(attempt + 1), 2000);
        }
      } catch (e) {
        console.warn('[discovery] peerStore lookup failed:', String(e).slice(0, 120));
      }
    };
    setTimeout(() => tryLookup(0), 1500);
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
    const peers = (node as any).peerStore?.peers?.() ?? [];
    return [...peers]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({
        peerId: p.id?.toString?.() ?? p.toString(),
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
