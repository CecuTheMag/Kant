import type { Libp2p } from 'libp2p';
import { multiaddr } from '@multiformats/multiaddr';

const locks = new WeakMap<object, Map<string, Promise<void>>>();

/** Serialize circuit stream setup for one destination on one node. */
export async function withSendLock<T>(node: Libp2p, key: string, fn: () => Promise<T>): Promise<T> {
  let nodeLocks = locks.get(node as object);
  if (!nodeLocks) {
    nodeLocks = new Map();
    locks.set(node as object, nodeLocks);
  }

  const previous = nodeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  nodeLocks.set(key, current);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (nodeLocks.get(key) === current) nodeLocks.delete(key);
  }
}

/**
 * Reuse an existing direct/circuit connection to the destination before
 * opening another relay circuit.  Circuit-relay-v2 creation is the fragile,
 * expensive operation; opening a new protocol stream on a live multiplexed
 * connection is the normal libp2p path.
 */
export async function getOrDialPeer(node: Libp2p, peerMultiaddr: string): Promise<any> {
  const peerId = peerMultiaddr.split('/p2p/').pop();
  if (peerId) {
    // Only reuse a connection that has at least one open stream or was opened
    // very recently. A connection with 0 streams that has been open for >30s
    // is likely a zombie — the WebSocket closed silently and libp2p hasn't
    // noticed yet. Dialing through it produces an immediate stream error.
    const now = Date.now();
    const existing = (node as any).getConnections?.().find((connection: any) => {
      if (connection.remotePeer?.toString?.() !== peerId) return false;
      if (connection.status !== undefined && connection.status !== 'open') return false;
      const streams = connection.streams?.length ?? 0;
      const age = now - (connection.timeline?.open ?? now);
      return streams > 0 || age < 30_000;
    });
    if (existing) return existing;
  }
  try {
    console.debug(`[send-lock] dialing ${peerMultiaddr}`);
    const res = await node.dial(multiaddr(peerMultiaddr));
    console.debug(`[send-lock] dial success ${peerMultiaddr}`);
    return res;
  } catch (e: any) {
    console.warn(`[send-lock] dial failed ${peerMultiaddr}: ${e?.message ?? e}`);
    throw e;
  }
}
