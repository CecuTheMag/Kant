/**
 * Contact reachability: which addresses may route to a contact.
 *
 * A Kant node's libp2p PeerID is derived from its Ed25519 identity key (see
 * createNode), so a contact's PeerID follows from their public key alone. The
 * only thing we ever need to learn is which relay holds their reservation.
 *
 * That makes routing hints safe to take from anywhere — our relay, their
 * relay, an invite link, a presence ping. A circuit address naming any other
 * PeerID is wrong by construction and is refused here; one naming theirs can
 * only ever reach them, because the Noise handshake proves the PeerID before a
 * byte of payload is sent. A bad hint can make a dial fail, never redirect it.
 */
import { publicKeyFromRaw } from '@libp2p/crypto/keys';
import { peerIdFromPublicKey } from '@libp2p/peer-id';

const HEX64 = /^[0-9a-f]{64}$/;
const PEER_ID_RE = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;
const MAX_ADDR_LENGTH = 1024;
const MAX_RELAY_URL_LENGTH = 256;

const peerIds = new Map<string, string>();

/** The libp2p PeerID a Kant identity runs under, or '' for a malformed key. */
export function peerIdForIdentity(publicKeyHex: string): string {
  const hex = typeof publicKeyHex === 'string' ? publicKeyHex.toLowerCase() : '';
  if (!HEX64.test(hex)) return '';
  const cached = peerIds.get(hex);
  if (cached) return cached;
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let id: string;
  try { id = peerIdFromPublicKey(publicKeyFromRaw(raw)).toString(); } catch { return ''; }
  // Presence pings from strangers also land here; keep the cache bounded.
  if (peerIds.size >= 1024) peerIds.clear();
  peerIds.set(hex, id);
  return id;
}

/**
 * True when `addr` is a circuit address (`…/p2p/<relay>/p2p-circuit/p2p/<peer>`)
 * whose destination is the node of `publicKeyHex`.
 */
export function addrReaches(addr: unknown, publicKeyHex: string): addr is string {
  if (typeof addr !== 'string' || addr.length > MAX_ADDR_LENGTH) return false;
  const i = addr.indexOf('/p2p-circuit/p2p/');
  if (i < 0) return false;
  const relayPeer = addr.slice(0, i).split('/p2p/').pop() ?? '';
  const target = addr.slice(i + '/p2p-circuit/p2p/'.length);
  if (!PEER_ID_RE.test(relayPeer) || !PEER_ID_RE.test(target)) return false;
  return target === peerIdForIdentity(publicKeyHex);
}

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h.startsWith('127.') || h === '::1' || h === '0.0.0.0';
}

/**
 * A contact's relay HTTP base URL in canonical form, or undefined when the
 * value isn't one we are willing to contact: http(s) only, no credentials,
 * query or fragment, and never a loopback host (which would mean *our* machine).
 */
export function contactRelayUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input || input.length > MAX_RELAY_URL_LENGTH) return undefined;
  let u: URL;
  try { u = new URL(input.trim()); } catch { return undefined; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  if (u.username || u.password || u.search || u.hash) return undefined;
  if (isLoopbackHost(u.hostname)) return undefined;
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}
