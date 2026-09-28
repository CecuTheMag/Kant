/**
 * Runtime half of relay federation: peer health, federated lookup and the
 * tunnel gatekeeper. The pure parsing/validation lives in federation.ts.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { peerIdFromString } from '@libp2p/peer-id';
import { log } from './logger.js';
import {
  federationLookups, federationPeerUp, federationTunnelBytes, federationTunnels, federationTunnelsActive,
} from './metrics.js';
import {
  PEER_ID_RE, TOKEN_MAX_AGE_MS, TUNNEL_PATH_PREFIX,
  apiEndpoint, decodeTunnelToken, isCircuitOnRelay, parseFederationConfig, relayMultiaddrToWs, spliceTunnel,
} from './federation.js';
import type { Located } from './federation.js';
import type { FederationPeerConfig } from './federation.js';

interface PeerState extends FederationPeerConfig {
  wsUrl: URL | null;
  up: boolean;
  lastError: string;
  checkedAt: number;
  /** Consecutive failed checks — drives the retry backoff. */
  failures: number;
  nextCheckAt: number;
}

export interface FederationOptions {
  raw: string | undefined;
  selfPeerId: string;
  /** Sign bytes with this relay's Ed25519 identity (for federated lookups). */
  sign: (msg: Uint8Array) => Uint8Array;
  publicKeyHex: string;
  /** Does this PeerID currently hold a connection to us? */
  isConnected: (peerId: string) => boolean;
  /** Advertised to clients so they know where to open tunnels. */
  tunnelBase: string;
  maxTunnels: number;
  maxTunnelsPerClient: number;
}

/** Healthy peers are re-checked this often; failing ones back off from RETRY_MIN_MS up to this. */
const HEALTH_INTERVAL_MS = 30_000;
const RETRY_MIN_MS = 5_000;
const TICK_MS = 5_000;
const FETCH_TIMEOUT_MS = 5_000;
const LOOKUP_TIMEOUT_MS = 2_500;

async function fetchJson(url: URL, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 256 * 1024) throw new Error('response too large');
  return JSON.parse(text);
}

export class Federation {
  readonly peers = new Map<string, PeerState>();
  private readonly usedNonces = new Map<string, number>();
  private readonly tunnelsByClient = new Map<string, number>();
  private active = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: FederationOptions) {
    const { peers, errors } = parseFederationConfig(opts.raw, opts.selfPeerId);
    for (const error of errors) log.error({ event: 'federation.config_error', error }, 'ignoring invalid RELAY_FEDERATION entry');
    for (const p of peers) this.peers.set(p.peerId, { ...p, wsUrl: null, up: false, lastError: 'not checked', checkedAt: 0, failures: 0, nextCheckAt: 0 });
  }

  get enabled(): boolean { return this.peers.size > 0; }

  start(): void {
    if (!this.enabled) return;
    log.info({ event: 'federation.enabled', peers: [...this.peers.values()].map((p) => ({ peerId: p.peerId, api: p.apiBase.origin })) }, 'relay federation enabled');
    void this.refresh();
    // A peer that is down (e.g. both relays rebooting together) is retried
    // within seconds, backing off to the normal interval — not left dark for a minute.
    this.timer = setInterval(() => { void this.refresh(true); }, TICK_MS);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  /** Re-read every peer's /relay-info; a peer is usable only if it still presents its pinned PeerID. */
  async refresh(onlyDue = false): Promise<void> {
    const now = Date.now();
    await Promise.all([...this.peers.values()].filter((p) => !onlyDue || p.nextCheckAt <= now).map(async (peer) => {
      try {
        const info = await fetchJson(apiEndpoint(peer.apiBase, 'relay-info')) as { peerId?: unknown; multiaddr?: unknown };
        if (info?.peerId !== peer.peerId) throw new Error(`presented PeerID ${String(info?.peerId).slice(0, 16)} ≠ pinned`);
        const parsed = typeof info.multiaddr === 'string' ? relayMultiaddrToWs(info.multiaddr) : null;
        if (!parsed || parsed.peerId !== peer.peerId) throw new Error('unusable announced multiaddr');
        if (!peer.up) log.info({ event: 'federation.peer_up', peerId: peer.peerId, ws: parsed.url.origin }, 'federation peer reachable');
        peer.wsUrl = parsed.url;
        peer.up = true;
        peer.lastError = '';
        peer.failures = 0;
      } catch (e: any) {
        // fetch() hides the real reason (ECONNREFUSED, cert error…) in `cause`.
        const err = [e?.message ?? e, e?.cause?.code ?? e?.cause?.message].filter(Boolean).join(': ');
        if (peer.up || peer.checkedAt === 0 || peer.failures % 12 === 11) log.warn({ event: 'federation.peer_down', peerId: peer.peerId, err, failures: peer.failures + 1 }, 'federation peer unreachable');
        peer.up = false;
        peer.lastError = err;
        peer.failures++;
      }
      peer.checkedAt = Date.now();
      peer.nextCheckAt = peer.checkedAt + (peer.up
        ? HEALTH_INTERVAL_MS
        : Math.min(HEALTH_INTERVAL_MS, RETRY_MIN_MS * 2 ** Math.min(peer.failures - 1, 4)));
      federationPeerUp.set({ peer: peer.peerId }, peer.up ? 1 : 0);
    }));
  }

  /** A lookup or tunnel to this peer just failed: re-check it on the next tick instead of waiting out the interval. */
  private suspect(peer: PeerState): void {
    peer.nextCheckAt = 0;
  }

  /** What /relay-info advertises. Only healthy peers — clients must not tunnel toward a dead relay. */
  info(): { tunnel: string; peers: string[] } | undefined {
    if (!this.enabled) return undefined;
    return { tunnel: this.opts.tunnelBase, peers: [...this.peers.values()].filter((p) => p.up).map((p) => p.peerId) };
  }

  status(): Array<{ peerId: string; api: string; up: boolean; lastError: string; checkedAt: number }> {
    return [...this.peers.values()].map((p) => ({ peerId: p.peerId, api: p.apiBase.origin, up: p.up, lastError: p.lastError, checkedAt: p.checkedAt }));
  }

  /**
   * Ask peer relays for keys we don't hold. Signed with this relay's key and
   * flagged `federated` (peers answer from their local registry only — no
   * recursion, no amplification). Only circuit addresses on the answering peer
   * are accepted.
   */
  /** Ask peer relays where `keys` are registered. Answers carry the entry's age when the peer reports it. */
  async lookup(keys: string[], sodium: any): Promise<Record<string, Located>> {
    const out: Record<string, Located> = {};
    const peers = [...this.peers.values()].filter((p) => p.up);
    if (!keys.length || !peers.length) return out;
    await Promise.all(peers.map(async (peer) => {
      const timestamp = Date.now();
      const nonce = sodium.to_hex(sodium.randombytes_buf(16));
      const sig = sodium.to_hex(this.opts.sign(new TextEncoder().encode(`${timestamp}|${nonce}|${keys.join(',')}`)));
      try {
        const res = await fetchJson(apiEndpoint(peer.apiBase, 'lookup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys, publicKeyHex: this.opts.publicKeyHex, timestamp, nonce, sig, federated: true }),
        }, LOOKUP_TIMEOUT_MS) as Record<string, unknown>;
        const ages = (res?.ages && typeof res.ages === 'object' ? res.ages : {}) as Record<string, unknown>;
        let found = 0;
        for (const key of keys) {
          const addr = res?.[key];
          if (!isCircuitOnRelay(addr, peer.peerId)) continue;
          const age = ages[key];
          const located: Located = { addr, ...(typeof age === 'number' && Number.isFinite(age) && age >= 0 ? { ageMs: age } : {}) };
          const prev = out[key];
          // Several peers: keep the most recently refreshed answer.
          if (!prev || (located.ageMs !== undefined && (prev.ageMs === undefined || located.ageMs < prev.ageMs))) out[key] = located;
          found++;
        }
        federationLookups.inc({ result: found ? 'hit' : 'miss' });
      } catch (e: any) {
        federationLookups.inc({ result: 'error' });
        this.suspect(peer);
        log.warn({ event: 'federation.lookup_error', peerId: peer.peerId, err: String(e?.message ?? e) }, 'federated lookup failed');
      }
    }));
    return out;
  }

  /** Is this an upgrade request for us? */
  handles(req: IncomingMessage): boolean {
    return this.enabled && !!req.url?.startsWith(TUNNEL_PATH_PREFIX);
  }

  /** Gatekeeper for `GET /fed/<peerId>?t=<token>` upgrades. */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const reject = (status: number, reason: string) => {
      federationTunnels.inc({ result: reason });
      socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : status === 503 ? 'Service Unavailable' : 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    try {
      if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return reject(400, 'not_websocket');
      const url = new URL(req.url ?? '', 'http://relay.invalid');
      const target = url.pathname.slice(TUNNEL_PATH_PREFIX.length);
      if (!PEER_ID_RE.test(target)) return reject(404, 'bad_target');
      const peer = this.peers.get(target);
      if (!peer) return reject(404, 'unknown_peer');
      if (!peer.up || !peer.wsUrl) return reject(503, 'peer_down');

      const decoded = decodeTunnelToken(url.searchParams.get('t') ?? '');
      if (!decoded) return reject(403, 'bad_token');
      const { claim, signed, sig } = decoded;
      if (claim.d !== target) return reject(403, 'token_target_mismatch');
      if (Math.abs(Date.now() - claim.t) > TOKEN_MAX_AGE_MS) return reject(403, 'token_expired');
      if (this.usedNonces.has(claim.n)) return reject(403, 'token_replay');
      const ok = await peerIdFromString(claim.p).publicKey?.verify(signed, sig);
      if (!ok) return reject(403, 'bad_signature');
      // Only users of this relay may tunnel: the signer must hold a live connection here.
      if (!this.opts.isConnected(claim.p)) return reject(403, 'not_a_local_client');
      this.usedNonces.set(claim.n, Date.now() + 2 * TOKEN_MAX_AGE_MS);
      this.sweepNonces();

      if (this.active >= this.opts.maxTunnels) return reject(503, 'capacity');
      const mine = this.tunnelsByClient.get(claim.p) ?? 0;
      if (mine >= this.opts.maxTunnelsPerClient) return reject(503, 'client_capacity');

      this.active++;
      this.tunnelsByClient.set(claim.p, mine + 1);
      federationTunnelsActive.set(this.active);
      federationTunnels.inc({ result: 'opened' });
      const openedAt = Date.now();
      log.info({ event: 'federation.tunnel_open', client: claim.p.slice(0, 16), peer: target.slice(0, 16) }, 'tunnel opened');
      let up = 0, down = 0;
      spliceTunnel(req, socket, head, peer.wsUrl, {
        onBytes: (direction, n) => {
          federationTunnelBytes.inc({ direction }, n);
          if (direction === 'up') up += n; else down += n;
        },
        onClose: (reason) => {
          if (reason.startsWith('upstream_') && up + down === 0) this.suspect(peer);
          this.active--;
          const left = (this.tunnelsByClient.get(claim.p) ?? 1) - 1;
          if (left > 0) this.tunnelsByClient.set(claim.p, left); else this.tunnelsByClient.delete(claim.p);
          federationTunnelsActive.set(this.active);
          log.info({ event: 'federation.tunnel_close', client: claim.p.slice(0, 16), peer: target.slice(0, 16), reason, up, down, seconds: Math.round((Date.now() - openedAt) / 1000) }, 'tunnel closed');
        },
      });
    } catch (e: any) {
      log.warn({ event: 'federation.tunnel_error', err: String(e?.message ?? e) }, 'tunnel request failed');
      reject(400, 'error');
    }
  }

  private sweepNonces(): void {
    if (this.usedNonces.size < 1000) return;
    const now = Date.now();
    for (const [n, expiry] of this.usedNonces) if (expiry <= now) this.usedNonces.delete(n);
  }
}
