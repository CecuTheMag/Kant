/**
 * Relay federation — lets a user on this relay reach a user on a peer relay
 * with traffic flowing  user1 → relay1 → relay2 → user2.
 *
 * Two pieces, both opt-in via RELAY_FEDERATION:
 *
 *  1. Federated lookup. When a /lookup misses locally, the relay asks its
 *     configured peers (signed with the relay's own Ed25519 key, flagged
 *     `federated` so peers never recurse). Answers are accepted only if the
 *     circuit address really lives on the peer that gave it.
 *
 *  2. Transport tunnel. `GET /fed/<peerRelayId>?t=<token>` with a WebSocket
 *     upgrade is spliced, byte for byte, onto the peer relay's libp2p
 *     WebSocket listener. The client then runs Noise with the peer relay
 *     *through* the tunnel and opens an ordinary circuit to the target user,
 *     which runs its own Noise end to end. This relay therefore forwards only
 *     ciphertext: it learns byte counts, never content, never who the client
 *     talks to beyond "someone on relay2". The peer relay sees this relay's IP,
 *     not the user's.
 *
 * Abuse controls: only configured, pinned peers are tunnel targets (never an
 * open proxy); only clients with a live connection to this relay may tunnel,
 * proven by a short-lived single-use token signed with their libp2p key;
 * global and per-client tunnel caps; handshake timeout.
 */
import net from 'node:net';
import tls from 'node:tls';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

export const PEER_ID_RE = /^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/;
export const TUNNEL_PATH_PREFIX = '/fed/';
export const TOKEN_MAX_AGE_MS = 60_000;

export interface FederationPeerConfig {
  /** HTTP(S) base of the peer relay's API (where /relay-info and /lookup live). */
  apiBase: URL;
  /** Pinned libp2p PeerID of the peer relay. */
  peerId: string;
}

/**
 * Parse RELAY_FEDERATION: comma/whitespace separated `<apiBaseUrl>#<peerId>`,
 * e.g. `https://relay2.example.org#12D3KooW…`. The PeerID pin means a DNS or
 * TLS compromise can't redirect federation to an impostor — the tunnel's Noise
 * handshake is checked against it, and lookup answers must name it.
 */
export function parseFederationConfig(raw: string | undefined, selfPeerId: string): { peers: FederationPeerConfig[]; errors: string[] } {
  const peers: FederationPeerConfig[] = [];
  const errors: string[] = [];
  for (const entry of (raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    const hash = entry.lastIndexOf('#');
    if (hash <= 0) { errors.push(`${entry}: expected <url>#<peerId>`); continue; }
    const url = entry.slice(0, hash);
    const peerId = entry.slice(hash + 1);
    let apiBase: URL;
    try { apiBase = new URL(url); } catch { errors.push(`${entry}: invalid URL`); continue; }
    if (apiBase.protocol !== 'https:' && apiBase.protocol !== 'http:') { errors.push(`${entry}: URL must be http(s)`); continue; }
    if (apiBase.username || apiBase.password || apiBase.search || apiBase.hash) { errors.push(`${entry}: URL must not carry credentials, query or fragment`); continue; }
    if (!PEER_ID_RE.test(peerId)) { errors.push(`${entry}: invalid PeerID`); continue; }
    if (peerId === selfPeerId) { errors.push(`${entry}: that is this relay`); continue; }
    if (peers.some((p) => p.peerId === peerId)) { errors.push(`${entry}: duplicate PeerID`); continue; }
    apiBase.pathname = apiBase.pathname.replace(/\/+$/, '');
    peers.push({ apiBase, peerId });
  }
  return { peers, errors };
}

/** `<apiBase>/<path>` without ever producing `//path` (which URL parsing treats as a host). */
export function apiEndpoint(apiBase: URL, path: string): URL {
  const basePath = apiBase.pathname.replace(/\/+$/, '');
  return new URL(`${apiBase.origin}${basePath}/${path.replace(/^\/+/, '')}`);
}

/**
 * Turn a relay's announced multiaddr (`/dns4/x/tcp/443/tls/ws/p2p/<id>`,
 * `/ip4/1.2.3.4/tcp/3000/ws/p2p/<id>`) into the WebSocket URL to splice onto,
 * plus the PeerID it names. Only the shapes relays announce are accepted.
 */
export function relayMultiaddrToWs(ma: string): { url: URL; peerId: string } | null {
  const m = /^\/(dns4|dns6|dns|ip4|ip6)\/([^/]+)\/tcp\/(\d{1,5})\/(tls\/ws|wss|ws)\/p2p\/([^/]+)$/.exec(ma);
  if (!m) return null;
  const [, family, host, portText, ws, peerId] = m;
  const port = Number(portText);
  if (!PEER_ID_RE.test(peerId) || port < 1 || port > 65535) return null;
  const secure = ws !== 'ws';
  const hostPart = family === 'ip6' ? `[${host}]` : host;
  try {
    return { url: new URL(`${secure ? 'wss' : 'ws'}://${hostPart}:${port}/`), peerId };
  } catch {
    return null;
  }
}

/**
 * A lookup answer from a peer is only believed if it is a circuit address
 * *on that peer* — a peer can't point our users at a third relay.
 */
export function isCircuitOnRelay(addr: unknown, relayPeerId: string): addr is string {
  if (typeof addr !== 'string' || addr.length > 512) return false;
  const m = /^(\/.+)\/p2p\/([^/]+)\/p2p-circuit\/p2p\/([^/]+)$/.exec(addr);
  return !!m && m[2] === relayPeerId && PEER_ID_RE.test(m[3]) && relayMultiaddrToWs(`${m[1]}/p2p/${m[2]}`) !== null;
}

/* ── Choosing between registrations ──────────────────────────────────────── */

/**
 * Clients re-register every 10 s while connected, so an entry that hasn't been
 * refreshed for this long means the device is no longer active here — it may
 * have moved to a peer relay (a device move, a changed relay setting).
 */
export const REGISTRATION_FRESH_MS = 30_000;

export interface Located {
  addr: string;
  /** Time since the entry was last refreshed, when known. */
  ageMs?: number;
  /** Local entries only: whether the device holds a reservation on this relay right now. */
  reachable?: boolean;
}

/**
 * Which registration to answer with. A fresh local entry wins outright (no
 * need to ask peers). A local entry whose device holds no reservation here is
 * a dead route, so any peer's answer beats it — even from an older relay that
 * doesn't report ages. Otherwise the most recently refreshed one wins, and a
 * peer answer without an age only fills a local miss.
 */
export function pickRegistration(local: Located | undefined, remote: Located | undefined): Located | undefined {
  if (!remote) return local;
  if (!local) return remote;
  if (local.ageMs !== undefined && local.ageMs < REGISTRATION_FRESH_MS) return local;
  if (local.reachable === false) return remote;
  if (remote.ageMs === undefined || local.ageMs === undefined) return local;
  return remote.ageMs < local.ageMs ? remote : local;
}

/* ── Tunnel tokens ───────────────────────────────────────────────────────── */

export interface TunnelClaim {
  /** Client's libp2p PeerID (must hold a live connection to this relay). */
  p: string;
  /** Destination relay PeerID (must match the path). */
  d: string;
  /** Issue time, ms. */
  t: number;
  /** Single-use nonce. */
  n: string;
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

export function encodeTunnelToken(claim: TunnelClaim, sig: Uint8Array): string {
  return `${b64url(new TextEncoder().encode(JSON.stringify(claim)))}.${b64url(sig)}`;
}

/** Parse without verifying: returns the claim, the exact signed bytes and the signature. */
export function decodeTunnelToken(token: string): { claim: TunnelClaim; signed: Uint8Array; sig: Uint8Array } | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [body, sigText, extra] = token.split('.');
  if (!body || !sigText || extra !== undefined) return null;
  try {
    const signed = new Uint8Array(Buffer.from(body, 'base64url'));
    const sig = new Uint8Array(Buffer.from(sigText, 'base64url'));
    const claim = JSON.parse(new TextDecoder().decode(signed)) as TunnelClaim;
    if (typeof claim?.p !== 'string' || !PEER_ID_RE.test(claim.p)) return null;
    if (typeof claim.d !== 'string' || !PEER_ID_RE.test(claim.d)) return null;
    if (typeof claim.t !== 'number' || !Number.isFinite(claim.t)) return null;
    if (typeof claim.n !== 'string' || !/^[0-9a-f]{16,64}$/.test(claim.n)) return null;
    if (sig.length !== 64) return null;
    return { claim, signed, sig };
  } catch {
    return null;
  }
}

/* ── Tunnel splice ───────────────────────────────────────────────────────── */

const HOP_BY_HOP_ALLOWED = new Set([
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions',
]);

/**
 * Build the upgrade request sent to the peer relay: the client's WebSocket
 * handshake headers (so the Sec-WebSocket-Accept check stays end to end), the
 * peer's own Host, and nothing identifying the client — no X-Forwarded-For.
 */
export function buildUpstreamUpgrade(req: IncomingMessage, target: URL): string {
  const lines = [
    `GET ${target.pathname || '/'} HTTP/1.1`,
    `Host: ${target.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
  ];
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_ALLOWED.has(name) || value === undefined) continue;
    const text = Array.isArray(value) ? value.join(', ') : value;
    if (/[\r\n]/.test(text)) continue;
    lines.push(`${name}: ${text}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

export interface SpliceHooks {
  onBytes(direction: 'up' | 'down', n: number): void;
  onClose(reason: string): void;
}

/**
 * Connect to the peer relay and splice the two sockets. The upstream reply
 * (101 + frames) goes back to the client untouched; everything afterwards is
 * opaque ciphertext in both directions.
 */
export function spliceTunnel(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  target: URL,
  hooks: SpliceHooks,
  handshakeTimeoutMs = 10_000,
): void {
  const port = Number(target.port || (target.protocol === 'wss:' ? 443 : 80));
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const upstream = target.protocol === 'wss:'
    ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ['http/1.1'] })
    : net.connect({ host, port });

  let closed = false;
  let gotReply = false;
  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    upstream.destroy();
    client.destroy();
    hooks.onClose(reason);
  };
  const timer = setTimeout(() => { if (!gotReply) close('upstream_handshake_timeout'); }, handshakeTimeoutMs);

  upstream.once(target.protocol === 'wss:' ? 'secureConnect' : 'connect', () => {
    upstream.setNoDelay(true);
    upstream.setKeepAlive(true, 30_000);
    upstream.write(buildUpstreamUpgrade(req, target));
    if (head.length) { upstream.write(head); hooks.onBytes('up', head.length); }
    client.on('data', (chunk: Buffer) => {
      hooks.onBytes('up', chunk.length);
      if (!upstream.write(chunk)) client.pause();
    });
    upstream.on('drain', () => client.resume());
  });
  upstream.on('data', (chunk: Buffer) => {
    gotReply = true;
    hooks.onBytes('down', chunk.length);
    if (!client.write(chunk)) upstream.pause();
  });
  client.on('drain', () => upstream.resume());
  // `end` as well as `close`: sockets handed over by http.Server's 'upgrade'
  // are half-open, so a client that disconnects only ever emits `end` — without
  // this the tunnel (and its upstream connection) would leak until the kernel
  // times it out.
  upstream.on('error', () => close('upstream_error'));
  upstream.on('end', () => close('upstream_closed'));
  upstream.on('close', () => close('upstream_closed'));
  client.on('error', () => close('client_error'));
  client.on('end', () => close('client_closed'));
  client.on('close', () => close('client_closed'));
}
