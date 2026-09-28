/**
 * Client side of relay federation (see packages/relay/src/federation.ts).
 *
 * When a contact's circuit lives on a *different* relay that our home relay
 * federates with, we don't dial that relay directly. We open a WebSocket to our
 * own relay's `/fed/<peerRelay>` endpoint, which splices it onto the peer
 * relay, and run Noise with the peer relay through it. The circuit to the
 * contact then goes over that connection with its own end-to-end Noise:
 *
 *     us ──ws──▶ home relay ══splice══▶ peer relay ──circuit──▶ contact
 *
 * Every Kant protocol (messages, receipts, prekeys, files, voice, onion) rides
 * the resulting ordinary libp2p connection, so nothing above this layer
 * changes. Neither relay can read content; the peer relay never learns our IP.
 *
 * While federation is configured, direct dials to a federated relay are
 * refused by the connection gater, so traffic can't silently bypass the home
 * relay (the property an enterprise egress policy relies on).
 */
import type { Libp2p } from 'libp2p';
import type { Multiaddr } from '@multiformats/multiaddr';
import { multiaddr } from '@multiformats/multiaddr';
import { transportSymbol } from '@libp2p/interface';
import { webSockets } from '@libp2p/websockets';
import { clog } from './index.js';

const PEER_ID_RE = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;
/** http-path segment the relay routes to its tunnel endpoint (URL-encoded "fed/"). */
const TUNNEL_SEGMENT = '/http-path/fed%2F';

export interface RelayFederationInfo {
  /** Multiaddr base of the home relay's tunnel endpoint, e.g. `/dns4/r1/tcp/443/tls/ws`. */
  tunnel: string;
  /** PeerIDs of peer relays the home relay can currently tunnel to. */
  peers: string[];
}

interface SigningKey { sign(data: Uint8Array): Uint8Array | Promise<Uint8Array> }

interface FederationState {
  homeRelay: string;
  tunnelBase: string;
  peers: Set<string>;
  key: SigningKey;
  inflight: Map<string, Promise<void>>;
}

const nodeKeys = new WeakMap<object, SigningKey>();
const states = new WeakMap<object, FederationState>();

/** createNode records the node's libp2p private key so tunnel tokens can be signed. */
export function rememberNodeKey(node: Libp2p, key: SigningKey): void {
  nodeKeys.set(node as object, key);
}

/** Last /p2p/<id> in a multiaddr string. */
function lastPeer(addr: string): string {
  return addr.split('/p2p/').pop() ?? '';
}

export function isTunnelMultiaddr(ma: Multiaddr | string): boolean {
  const s = ma.toString();
  return s.includes(TUNNEL_SEGMENT) && /\/(tls\/ws|ws|wss)\/http-path\//.test(s) && PEER_ID_RE.test(lastPeer(s));
}

/** Split `<relay…>/p2p/<relayId>/p2p-circuit/p2p/<target>`. */
export function parseCircuit(addr: string): { relayPeer: string; target: string } | null {
  const i = addr.indexOf('/p2p-circuit');
  if (i < 0) return null;
  const relayPeer = lastPeer(addr.slice(0, i));
  const target = lastPeer(addr);
  return PEER_ID_RE.test(relayPeer) && PEER_ID_RE.test(target) ? { relayPeer, target } : null;
}

/**
 * Validate what the home relay advertised (untrusted input) and turn
 * federation on for this node, or off when the relay offers none.
 */
export function configureFederation(node: Libp2p, homeRelayAddr: string, info: unknown): boolean {
  const key = nodeKeys.get(node as object);
  const homeRelay = lastPeer(homeRelayAddr);
  const fed = info as Partial<RelayFederationInfo> | undefined;
  const tunnel = typeof fed?.tunnel === 'string' ? fed.tunnel : '';
  const tunnelOk = /^\/(dns4|dns6|dns|ip4|ip6)\/[^/]+\/tcp\/\d{1,5}\/(tls\/ws|ws|wss)$/.test(tunnel);
  const peers = Array.isArray(fed?.peers)
    ? fed!.peers!.filter((p): p is string => typeof p === 'string' && PEER_ID_RE.test(p) && p !== homeRelay).slice(0, 64)
    : [];
  if (!key || !PEER_ID_RE.test(homeRelay) || !tunnelOk || !peers.length) {
    states.delete(node as object);
    return false;
  }
  const previous = states.get(node as object);
  states.set(node as object, { homeRelay, tunnelBase: tunnel, peers: new Set(peers), key, inflight: previous?.inflight ?? new Map() });
  clog(`🌐 Federation: ${peers.length} peer relay(s) reachable through ${homeRelay.slice(0, 12)}…`);
  return true;
}

export function federatedRelays(node: Libp2p): string[] {
  return [...(states.get(node as object)?.peers ?? [])];
}

/**
 * Connection-gater hook: refuse direct dials to a federated relay while
 * federation is on. Tunnel addresses and our home relay are always allowed.
 */
export function denyDirectFederatedDial(node: Libp2p | undefined, ma: Multiaddr): boolean {
  if (!node) return false;
  const st = states.get(node as object);
  if (!st) return false;
  const s = ma.toString();
  if (s.includes('/p2p-circuit')) return false;
  const peer = lastPeer(s);
  return st.peers.has(peer) && peer !== st.homeRelay && !isTunnelMultiaddr(s);
}

const toB64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** A fresh single-use token proving we are this node, for this peer relay, now. */
async function tunnelToken(node: Libp2p, key: SigningKey, relayPeer: string): Promise<string> {
  const claim = { p: node.peerId.toString(), d: relayPeer, t: Date.now(), n: randomHex(16) };
  const signed = new TextEncoder().encode(JSON.stringify(claim));
  const sig = await key.sign(signed);
  return `${toB64url(signed)}.${toB64url(sig)}`;
}

function hasOpenConnection(node: Libp2p, peer: string): boolean {
  return (node as any).getConnections?.().some((c: any) =>
    c.remotePeer?.toString?.() === peer && (c.status === undefined || c.status === 'open')) ?? false;
}

/** Make sure a connection to `relayPeer` exists, opening it through our home relay. Single-flight per relay. */
async function ensureTunnel(node: Libp2p, st: FederationState, relayPeer: string): Promise<void> {
  if (hasOpenConnection(node, relayPeer)) return;
  const pending = st.inflight.get(relayPeer);
  if (pending) return pending;
  const attempt = (async () => {
    const token = await tunnelToken(node, st.key, relayPeer);
    const path = encodeURIComponent(`fed/${relayPeer}?t=${token}`);
    const addr = `${st.tunnelBase}/http-path/${path}/p2p/${relayPeer}`;
    clog(`🌐 Tunnel → ${relayPeer.slice(0, 12)}… via home relay ${st.homeRelay.slice(0, 12)}…`);
    await node.dial(multiaddr(addr));
  })();
  st.inflight.set(relayPeer, attempt);
  try { await attempt; } finally { st.inflight.delete(relayPeer); }
}

/**
 * The address to actually dial for a peer circuit address. Circuits on a
 * federated relay are reached through a tunnel; everything else is unchanged.
 */
export async function routeDialAddr(node: Libp2p, addr: string): Promise<string> {
  const st = states.get(node as object);
  if (!st) return addr;
  const c = parseCircuit(addr);
  if (!c || c.relayPeer === st.homeRelay || !st.peers.has(c.relayPeer)) return addr;
  await ensureTunnel(node, st, c.relayPeer);
  // Bare form: the circuit transport reuses the live (tunnelled) relay connection by PeerID.
  return `/p2p/${c.relayPeer}/p2p-circuit/p2p/${c.target}`;
}

/** Connect to a relay, through the home relay when it is a federated one. */
export async function ensureRelayConnection(node: Libp2p, relayAddr: string): Promise<void> {
  const st = states.get(node as object);
  const relayPeer = lastPeer(relayAddr);
  if (st && st.peers.has(relayPeer) && relayPeer !== st.homeRelay) {
    await ensureTunnel(node, st, relayPeer);
    return;
  }
  await node.dial(multiaddr(relayAddr));
}

/**
 * Dial-only transport for tunnel addresses. It is the stock WebSocket
 * transport (which already knows how to put an http-path in the URL) with a
 * filter that claims exactly the `/http-path/fed%2F…` addresses the plain
 * WebSocket transport refuses.
 */
export function relayTunnelTransport(init: Parameters<typeof webSockets>[0] = {}) {
  const base = webSockets(init);
  return (components: any) => {
    const inner: any = base(components);
    return {
      [transportSymbol]: true as const,
      [Symbol.toStringTag]: '@kant/relay-tunnel',
      dial: (ma: Multiaddr, options: any) => inner.dial(ma, options),
      createListener: () => { throw new Error('relay tunnel transport is dial-only'); },
      listenFilter: () => [],
      dialFilter: (mas: Multiaddr[]) => mas.filter((ma) => isTunnelMultiaddr(ma)),
    };
  };
}
