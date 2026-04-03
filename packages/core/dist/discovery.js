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
/**
 * Start passive peer discovery: listen for peer:connect events and
 * surface any peer that has circuit-relay multiaddrs (i.e. reachable peers).
 * Returns a cleanup function.
 */
export function startDiscovery(node, onPeer) {
    const seen = new Set();
    function handleConnect(event) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const peerId = event.detail.toString();
        if (seen.has(peerId))
            return;
        seen.add(peerId);
        // Give identify a moment to populate multiaddrs
        setTimeout(() => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const peerInfo = node.peerStore?.get?.(peerId);
                const addrs = peerInfo?.addresses?.map((a) => a.multiaddr.toString()) ?? [];
                const circuit = addrs.filter(a => a.includes('/p2p-circuit'));
                if (circuit.length > 0) {
                    console.log('[discovery] peer found:', peerId.slice(0, 20), circuit[0]);
                    onPeer({ peerId, multiaddrs: circuit });
                }
            }
            catch (e) {
                console.warn('[discovery] peerStore lookup failed:', e);
            }
        }, 1500);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.addEventListener('peer:connect', handleConnect);
    console.log('[discovery] listening for peers');
    return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        node.removeEventListener('peer:connect', handleConnect);
    };
}
/**
 * Get all currently known peers with circuit addresses from the peer store.
 */
export function getKnownPeers(node) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const peers = node.peerStore?.all?.() ?? [];
        return peers
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((p) => ({
            peerId: p.id.toString(),
            multiaddrs: (p.addresses ?? [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((a) => a.multiaddr.toString())
                .filter((a) => a.includes('/p2p-circuit'))
        }))
            .filter((p) => p.multiaddrs.length > 0);
    }
    catch {
        return [];
    }
}
