// Kant Relay — libp2p circuit relay v2 bootstrap node
// Stateless: sees only encrypted noise packets, no message content

// Node 18 polyfills — libp2p v3 requires these
if (typeof globalThis.CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent extends Event {
    detail: unknown;
    constructor(type: string, options?: CustomEventInit) {
      super(type, options);
      this.detail = options?.detail ?? null;
    }
  };
}

if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve!: (v: unknown) => void;
    let reject!: (r: unknown) => void;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { createServer } from 'http';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { log } from './logger.js';
import { registry, circuitsClosed,
         peersConnected, peersDisconnected, peersActive, registryEntries, registryEvictions,
         registerRequests, lookupRequests, lookupHits, lookupMisses, registerDuration, lookupDuration,
         relayReady, opkBurnFailures, reservationErrors, reservationsRemoved,
         pushWakes, pushSubscriptionsGauge, lookupStaleEntries } from './metrics.js';
import { startReservationSync, getActiveReservations,
         getReservation, evictReservation, getReservationCount, untrackReservation } from './reservations.js';

const require = createRequire(import.meta.url);
const sodium: any = require('libsodium-wrappers-sumo');
await sodium.ready;

const RELAY_PORT = parseInt(process.env.RELAY_PORT ?? '3000');
const RELAY_PUBLIC_PORT = process.env.RELAY_PUBLIC_PORT 
  ? parseInt(process.env.RELAY_PUBLIC_PORT)
  : (process.env.RELAY_SECURE === 'true' ? 443 : RELAY_PORT);
const RELAY_INFO_PORT = parseInt(process.env.RELAY_INFO_PORT ?? '3001');
// Deliberately opt-in, and used only by the disposable Docker lab.  It lets
// the reconnect test terminate the relay process without mounting the Docker
// socket into the test runner. Docker's restart policy then starts a fresh
// process with the persisted seed, which is the failure mode users see.
const LAB_CONTROL_TOKEN = process.env.RELAY_LAB_CONTROL_TOKEN ?? '';

// ── Deterministic PeerID ──────────────────────────────────────────────────────
// Persist a seed so the relay keeps the same PeerID (and thus the same circuit
// address base) across restarts. Without this, every restart produces a new
// PeerID and all stored circuit addresses held by clients become invalid.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = process.env.RELAY_DATA_DIR ?? join(__dirname, '..', 'data');
const SEED_FILE = join(DATA_DIR, `relay-seed-${RELAY_PORT}.bin`);

let seedBytes: Uint8Array;
if (existsSync(SEED_FILE)) {
  seedBytes = new Uint8Array(readFileSync(SEED_FILE));
  if (seedBytes.byteLength !== 32) {
    throw new Error(`Relay seed must be exactly 32 bytes, got ${seedBytes.byteLength}`);
  }
  chmodSync(SEED_FILE, 0o600);
  log.info({ event: 'seed.loaded', path: SEED_FILE }, 'Loaded relay seed');
} else {
  seedBytes = sodium.randombytes_buf(32);
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SEED_FILE, Buffer.from(seedBytes), { mode: 0o600, flag: 'wx' });
  log.info({ event: 'seed.generated', path: SEED_FILE }, 'Generated new relay seed');
}

const relayPrivateKey = await generateKeyPairFromSeed('Ed25519', seedBytes);

// ── Compute public multiaddr before libp2p init ──────────────────────────────
// We need the full relay address for the `announce` list so libp2p only
// advertises the public IP — without this, Docker bridge (172.x) and
// 127.0.0.1 leak into peer discovery and cause dial failures.
import { networkInterfaces } from 'os';
import net from 'net';

function getLocalIp(): string {
  const ifaces = networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

const PUBLIC_HOST = process.env.RELAY_PUBLIC_HOST ?? getLocalIp();
if (PUBLIC_HOST === '127.0.0.1' || PUBLIC_HOST === '::1' || PUBLIC_HOST === 'localhost') {
  log.warn({ event: 'config.public_host_loopback', host: PUBLIC_HOST }, 'remote peers will not be able to connect');
}

let hostProto = 'dns4';
if (net.isIPv4(PUBLIC_HOST)) hostProto = 'ip4';
else if (net.isIPv6(PUBLIC_HOST)) hostProto = 'ip6';

// libp2p uses /tls/ws for secure websockets, not /wss
const wsProto = process.env.RELAY_SECURE === 'true' ? 'tls/ws' : 'ws';

// PeerID is deterministic from the seed — we can compute it before libp2p starts.
// libp2p uses the same Ed25519 keypair, so peerId.toString() will match.
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
const _prePeerId = await peerIdFromPrivateKey(relayPrivateKey);
const fullRelayAddr = `/${hostProto}/${PUBLIC_HOST}/tcp/${RELAY_PUBLIC_PORT}/${wsProto}/p2p/${_prePeerId.toString()}`;

const node = await createLibp2p({
  privateKey: relayPrivateKey,
  addresses: {
    listen: [`/ip4/0.0.0.0/tcp/${RELAY_PORT}/ws`],
    // Only announce the public address — without this, libp2p advertises
    // all local interfaces (Docker bridge 172.x, 127.0.0.1) and peers waste
    // dial attempts on unreachable internal addresses.
    announce: [fullRelayAddr]
  },
  transports: [webSockets()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  // libp2p's built-in connection monitor (default: enabled) pings every peer
  // every 10s with /ipfs/ping/1.0.0 and ABORTS the connection when the ping
  // fails (abortConnectionOnPingFailure defaults to true). Kant clients use
  // their own PING_PROTOCOL, not the libp2p ping protocol, so the relay's
  // monitor always saw a failed ping and dropped every client ~30s after
  // connect. The relay must never be the side that kills idle connections.
  connectionMonitor: { enabled: false },
  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: {
        maxReservations: 1024,
        // circuit-relay-v2 defaults cap each relayed connection at ~128 KiB /
        // 2 min, after which it is closed. That silently breaks long-lived
        // messaging streams and any file transfer larger than 128 KiB. Raise
        // both so relayed connections behave like ordinary long-lived links.
        defaultDataLimit: BigInt(2 * 1024 * 1024 * 1024), // 2 GiB per connection
        defaultDurationLimit: 12 * 60 * 60 * 1000,        // 12 hours
      }
    })
  }
});

await node.start();

const addrs = node.getMultiaddrs().map((a: any) => a.toString());
log.info({ event: 'relay.started', peerId: node.peerId.toString(), multiaddrs: addrs }, 'Kant relay running');
log.info({ event: 'relay.address', addr: fullRelayAddr }, 'Full relay addr');

const peerId = node.peerId.toString();

// Set readiness gate now that node.start() has succeeded.
relayReady.set({ gate: 'ready' }, 1);
relayReady.set({ gate: 'not_ready' }, 0);

// Basic runtime diagnostics to help track down intermittent circuit-relay errors
(node as any).addEventListener?.('peer:connect', (ev: any) => {
  try {
    const id = ev?.detail?.toString?.() ?? String(ev);
    // circuit-relay-v2 refreshes an existing reservation for a deterministic
    // PeerID without replacing its socket address. If the client reconnects
    // before the old reservation TTL expires, HOP CONNECT is consequently
    // routed to a dead connection and returns CONNECTION_FAILED. Remove only
    // reservations whose recorded address matches none of the peer's current
    // connections; the incoming client can then reserve against its new
    // connection normally.
    const relayReservations = (node as any).services?.relay?.reservations;
    const existingReservation = relayReservations?.get?.(ev.detail);
    if (existingReservation) {
      const reservedAddr = existingReservation.addr?.toString?.() ?? '';
      const hasMatchingConnection = ((node as any).getConnections?.(ev.detail) ?? [])
        .some((connection: any) => connection.remoteAddr?.toString?.() === reservedAddr);
      if (reservedAddr && !hasMatchingConnection) {
        relayReservations.delete(ev.detail);
        registryEvictions.inc({ reason: 'stale_reservation_reconnect' });
        log.warn({ event: 'reservation.stale_reconnect', remotePeer: id, reservedAddr },
          'removed reservation bound to a closed connection');
      }
    }
    peersConnected.inc();
    peersActive.set((node as any).getConnections?.().length ?? 0);
    log.info({ event: 'peer.connect', remotePeer: id }, 'peer connected');
  } catch {}
});
(node as any).addEventListener?.('peer:disconnect', (ev: any) => {
  try {
    const id = ev?.detail?.toString?.() ?? String(ev);
    // The server's reservation PeerMap can retain a socket after its final
    // connection closes. A reconnect briefly emits disconnect before its new
    // socket opens, so defer eviction and recheck instead of deleting a live
    // reservation during normal transport churn.
    const disconnectedPeer = ev.detail;
    setTimeout(() => {
      if (((node as any).getConnections?.(disconnectedPeer) ?? []).length > 0) return;
      const relayReservations = (node as any).services?.relay?.reservations;
      if (relayReservations?.get?.(disconnectedPeer)) {
        relayReservations.delete(disconnectedPeer);
        untrackReservation(id);
        reservationsRemoved.inc({ reason: 'peer_disconnected' });
        log.info({ event: 'reservation.removed_disconnect', remotePeer: id },
          'removed reservation after final peer connection closed');
      }
    }, 5000).unref();
    peersDisconnected.inc();
    peersActive.set((node as any).getConnections?.().length ?? 0);
    log.info({ event: 'peer.disconnect', remotePeer: id }, 'peer disconnected');
  } catch {}
});

// Circuit-relay reservation tracking — circuit-relay-v2 4.x declares server
// reservation events ('relay:reservation', 'relay:created-reservation', ...)
// but never dispatches any of them, so node-level event listeners stay dead
// and reservation metrics read zero forever. Poll the service's live
// reservation store instead (see reservations.ts).
startReservationSync(node);

function classifyRelayError(value: any): string {
  const message = String(value?.stack ?? value?.message ?? value ?? 'unknown');
  if (message.includes('NO_RESERVATION')) return 'NO_RESERVATION';
  if (/decode|protobuf|unexpected end of data|invalid wire/i.test(message)) return 'decode';
  if (/stream.*limit|too many streams|RESOURCE_LIMIT_EXCEEDED/i.test(message)) return 'stream_limit';
  return 'unhandled';
}

function recordRelayError(value: any, source: string): string {
  const code = classifyRelayError(value);
  reservationErrors.inc({ code });
  circuitsClosed.inc({ direction: 'unknown', reason: code });
  log.error({ event: 'relay.error', source, code, error: value?.stack ?? value }, 'relay runtime error');
  return code;
}

process.on('uncaughtException', (error: any) => {
  recordRelayError(error, 'uncaughtException');
  relayReady.set({ gate: 'ready' }, 0);
  relayReady.set({ gate: 'not_ready' }, 1);
  setTimeout(() => process.exit(1), 50).unref();
});
process.on('unhandledRejection', (reason: any) => {
  const code = recordRelayError(reason, 'unhandledRejection');
  // Malformed/obsolete peer frames and exhausted stream limits are isolated
  // connection failures. Keep the relay up; unknown application failures are
  // restarted by the container supervisor instead of leaving corrupt state.
  if (code === 'decode' || code === 'stream_limit' || code === 'NO_RESERVATION') return;
  relayReady.set({ gate: 'ready' }, 0);
  relayReady.set({ gate: 'not_ready' }, 1);
  setTimeout(() => process.exit(1), 50).unref();
});

// -- Push notifications (Signal-style) ----------------------------------------
//
// Two delivery paths, same relay-side trigger:
//   fcm     -- Android/iOS. Relay calls the push proxy (PUSH_PROXY_URL) which
//              holds Firebase credentials. Relay operators need no Firebase setup.
//   webpush -- Desktop PWA via Web Push / service worker. VAPID keys are
//              per-relay so this stays in the relay directly.
//
// The relay fires a wake signal when a lookup misses (peer is offline).
// Neither path ever carries message content.

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     ?? 'mailto:admin@kant.local';
const PUSH_PROXY_URL    = process.env.PUSH_PROXY_URL    ?? '';
const PUSH_PROXY_SECRET = process.env.PUSH_PROXY_SECRET ?? '';

type PushRecord =
  | { type: 'fcm';     token: string }
  | { type: 'webpush'; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } };

const pushSubscriptions = new Map<string, PushRecord>();

function publishPushMetrics(): void {
  let fcm = 0;
  let webpush = 0;
  for (const record of pushSubscriptions.values()) {
    if (record.type === 'fcm') fcm++;
    else webpush++;
  }
  pushSubscriptionsGauge.set({ kind: 'fcm' }, fcm);
  pushSubscriptionsGauge.set({ kind: 'webpush' }, webpush);
}

/** Result of a push-proxy call. `body` is the raw response, needed by /wake. */
type ProxyResult = { ok: boolean; body: string };

async function callPushProxy(path: string, method: 'POST' | 'DELETE', body?: string): Promise<ProxyResult> {
  if (!PUSH_PROXY_URL) return { ok: false, body: '' };
  try {
    const base = PUSH_PROXY_URL.replace(/\/$/, '');
    const payload = body ?? '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
    };
    if (PUSH_PROXY_SECRET) headers['Authorization'] = `Bearer ${PUSH_PROXY_SECRET}`;
    const url = new URL(`${base}${path}`);
    const { request } = url.protocol === 'https:' ? await import('https') : await import('http');
    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = request(url.toString(), { method, headers }, (res) => {
        res.setEncoding('utf8');
        let raw = '';
        res.on('data', (chunk: string) => { raw += chunk; });
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`proxy returned HTTP ${res.statusCode}`));
            return;
          }
          resolve(raw);
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
    return { ok: true, body: responseBody };
  } catch (err) {
    log.warn({ event: 'push_proxy.error', err: String(err) }, 'push proxy call failed');
    return { ok: false, body: '' };
  }
}

async function sendFcmWakeViaProxy(identityKeyHex: string): Promise<void> {
  if (!PUSH_PROXY_URL) {
    pushWakes.inc({ transport: 'fcm', result: 'proxy_not_configured' });
    log.warn({ event: 'push.proxy_unconfigured', key: identityKeyHex.slice(0, 12) },
      'FCM wake requested but PUSH_PROXY_URL is unset — Android devices cannot be woken');
    return;
  }
  const body = JSON.stringify({ identityKeyHex });
  const result = await callPushProxy('/wake', 'POST', body);
  if (!result.ok) {
    pushWakes.inc({ transport: 'fcm', result: 'failed' });
    return;
  }

  // The proxy answers 200 whether or not it holds a token for this identity,
  // so a bare "the call succeeded" would count unregistered devices as woken.
  // `dispatched` is what actually distinguishes them.
  let dispatched = false;
  try {
    dispatched = (JSON.parse(result.body) as { dispatched?: boolean })?.dispatched === true;
  } catch {
    // Older proxies predate the `dispatched` field; treat them as unknown
    // rather than silently inflating the sent count.
  }
  pushWakes.inc({ transport: 'fcm', result: dispatched ? 'sent' : 'no_token' });
  if (!dispatched) {
    log.warn({ event: 'push.no_token_at_proxy', key: identityKeyHex.slice(0, 12) },
      'push proxy holds no token for this identity — device cannot be woken');
  }
}

async function sendWebPushNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    pushWakes.inc({ transport: 'webpush', result: 'vapid_not_configured' });
    return;
  }
  const { createCipheriv, randomBytes } = await import('crypto');
  const subtle = (await import('crypto')).webcrypto.subtle;
  try {
    const url = new URL(sub.endpoint);
    const vapidHeader = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
    const vapidClaims = Buffer.from(JSON.stringify({
      aud: `${url.protocol}//${url.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT,
    })).toString('base64url');
    const sigInput = `${vapidHeader}.${vapidClaims}`;
    const vapidPrivKey = await subtle.importKey('pkcs8', Buffer.from(VAPID_PRIVATE_KEY, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidPrivKey, Buffer.from(sigInput))).toString('base64url');
    const jwt = `${sigInput}.${sig}`;

    // RFC 8291 aes128gcm
    const plaintext = Buffer.from(JSON.stringify({ type: 'wake' }));
    const salt = randomBytes(16);
    const senderKP = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const senderPub = Buffer.from(await subtle.exportKey('raw', senderKP.publicKey));
    const receiverPub = await subtle.importKey('raw', Buffer.from(sub.keys.p256dh, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ikm = Buffer.from(await subtle.deriveBits({ name: 'ECDH', public: receiverPub }, senderKP.privateKey, 256));
    const authSecret = Buffer.from(sub.keys.auth, 'base64url');
    const prkKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const prk = Buffer.from(await subtle.deriveBits({
      name: 'HKDF', hash: 'SHA-256', salt: authSecret,
      info: Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(sub.keys.p256dh, 'base64url'), senderPub]),
    }, prkKey, 256));
    const cekKey = await subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
    const cek = Buffer.from(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: Buffer.from('Content-Encoding: aes128gcm\0') }, cekKey, 128));
    const nonce = Buffer.from(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: Buffer.from('Content-Encoding: nonce\0') }, cekKey, 96));
    const cipher = createCipheriv('aes-128-gcm', cek, nonce);
    const ct = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);
    const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
    const encBody = Buffer.concat([salt, rs, Buffer.from([senderPub.length]), senderPub, ct]);

    const { request } = url.protocol === 'https:' ? await import('https') : await import('http');
    await new Promise<void>((resolve, reject) => {
      const req = request(sub.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`, 'TTL': '86400', 'Content-Length': String(encBody.length) },
      }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject); req.write(encBody); req.end();
    });
    pushWakes.inc({ transport: 'webpush', result: 'sent' });
  } catch (err) {
    pushWakes.inc({ transport: 'webpush', result: 'failed' });
    log.warn({ event: 'webpush.error', err: String(err) }, 'Web Push send failed');
  }
}

// A wake is a hint, not a message: one is enough to bring a device back. Senders
// poll /lookup, and every contact of an offline peer polls independently, so an
// uncooldowned trigger would emit a wake per lookup per sender — draining the
// device battery and burning FCM quota. Collapse them into one wake per window.
const WAKE_COOLDOWN_MS = 30_000;
const lastWakeAt = new Map<string, number>();

async function sendPushNotification(identityKeyHex: string): Promise<void> {
  const now = Date.now();
  const previous = lastWakeAt.get(identityKeyHex);
  if (previous !== undefined && now - previous < WAKE_COOLDOWN_MS) {
    pushWakes.inc({ transport: 'any', result: 'suppressed_cooldown' });
    return;
  }
  lastWakeAt.set(identityKeyHex, now);

  const record = pushSubscriptions.get(identityKeyHex);
  if (!record) {
    // The proxy owns durable FCM registrations. Relay restarts must not make
    // offline Android devices unreachable just because this local map reset.
    if (PUSH_PROXY_URL) {
      await sendFcmWakeViaProxy(identityKeyHex);
      return;
    }
    pushWakes.inc({ transport: 'none', result: 'no_subscription' });
    log.info({ event: 'push.no_subscription', key: identityKeyHex.slice(0, 12) }, 'offline peer has no registered push subscription');
    return;
  }
  if (record.type === 'fcm') await sendFcmWakeViaProxy(identityKeyHex);
  else await sendWebPushNotification(record.subscription);
}

/**
 * Whether a peer can actually be reached through this relay right now.
 *
 * A registered circuit address only routes while the peer holds a live
 * reservation. Identity entries deliberately outlive peer:disconnect so a
 * reconnecting client stays discoverable (see the peer:disconnect handler), and
 * the registry TTL is 5 minutes — so a lookup can match an entry whose circuit
 * died minutes ago. That is the normal state of a phone in Doze: still
 * registered, no longer reachable. Treat those as offline so they get woken.
 */
function isPeerReachable(peerId: string): boolean {
  if (!peerId) return false;
  if (getReservation(peerId)?.status === 'active') return true;
  // Reservation sync polls on an interval, so a peer that reconnected in the
  // last few seconds may not be tracked yet. A live transport connection is an
  // equally authoritative signal.
  try {
    return ((node as any).getConnections?.() ?? [])
      .some((connection: any) => connection.remotePeer?.toString?.() === peerId);
  } catch {
    return false;
  }
}

// ── Peer registry ─────────────────────────────────────────────────────────────
// A circuit reservation is ephemeral.  Keeping an address for a day after a
// browser sleep, network change, or relay restart makes /lookup confidently
// return a route that can only fail with NO_RESERVATION.  Clients refresh their
// registration every 10s, so a short soft-state TTL makes stale routes vanish
// quickly without requiring unreliable peer:disconnect events.
const REGISTRY_TTL_MS = 5 * 60 * 1000; // 5 min — clients re-register every 2 min so 5 min gives 2 missed heartbeats of headroom
const configuredRegistryLimit = Number.parseInt(process.env.RELAY_MAX_REGISTRY_ENTRIES ?? '10000', 10);
const MAX_REGISTRY_ENTRIES = Number.isSafeInteger(configuredRegistryLimit) && configuredRegistryLimit > 0
  ? configuredRegistryLimit
  : 10_000;
const peerRegistry = new Map<string, { circuitAddr: string; peerId: string; registeredAt: number; isIdentityEntry?: boolean }>();

function publishRegistryMetrics(): void {
  let ephemeral = 0;
  let identity = 0;
  for (const entry of peerRegistry.values()) {
    if (entry.isIdentityEntry) identity++;
    else ephemeral++;
  }
  registryEntries.set({ kind: 'ephemeral' }, ephemeral);
  registryEntries.set({ kind: 'identity' }, identity);
}

// A circuit address is usable only while the client keeps its reservation
// connection open. Remove registry entries with the reservation so lookups do
// not hand out addresses that the relay will reject with NO_RESERVATION.
(node as any).addEventListener('peer:disconnect', (event: any) => {
  const disconnectedPeerId = event.detail?.toString?.();
  if (!disconnectedPeerId) return;
  // Only remove ephemeral-key entries on disconnect (keys that are NOT also
  // indexed as an identity key by another entry). Identity-key entries must
  // survive a reconnect so lookups keep working while the peer re-registers.
  // Stale identity entries are evicted by the TTL sweep instead.
  const identityPeerIds = new Set<string>();
  for (const [, entry] of peerRegistry) {
    if (entry.isIdentityEntry) identityPeerIds.add(entry.peerId);
  }
  for (const [hex, entry] of peerRegistry) {
    if (entry.peerId === disconnectedPeerId && !entry.isIdentityEntry) {
      peerRegistry.delete(hex);
      registryEvictions.inc({ reason: 'peer_disconnected' });
      log.info({ event: 'registry.removed', keyHex: hex.slice(0, 12), reason: 'peer_disconnected' }, 'removed ephemeral registration');
    }
  }
  publishRegistryMetrics();
});

// nonce -> expiry timestamp (ms). Replay protection only needs to remember a
// nonce for as long as its timestamp could still pass the ±60s freshness check.
const NONCE_TTL_MS = 120000; // 2 min (comfortably covers the 60s skew window)
const usedNonces = new Map<string, number>();
// Age-based sweep: drop only nonces whose TTL has elapsed. Unlike a blanket
// clear() this can never evict a still-valid nonce, so it can't open a replay
// window under load.
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiry] of usedNonces) {
    if (expiry <= now) usedNonces.delete(nonce);
  }
  // Evict registry entries that haven't re-registered within the TTL.
  for (const [hex, entry] of peerRegistry) {
    if (now - entry.registeredAt > REGISTRY_TTL_MS) {
      peerRegistry.delete(hex);
      registryEvictions.inc({ reason: 'ttl_expired' });
      log.info({ event: 'registry.evicted', keyHex: hex.slice(0, 12), reason: 'ttl_expired' }, 'evicted stale entry');
    }
  }
  // Drop wake-cooldown records once their window has passed; the map is keyed
  // by identity and would otherwise grow for the lifetime of the process.
  for (const [hex, at] of lastWakeAt) {
    if (now - at > WAKE_COOLDOWN_MS) lastWakeAt.delete(hex);
  }
  publishRegistryMetrics();
}, 60000); // every minute

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/relay-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peerId, multiaddr: fullRelayAddr }));
    return;
  }

  if (req.url === '/favicon.png') {
    try {
      const iconPath = join(__dirname, '..', 'public', 'favicon.png');
      const data = readFileSync(iconPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
      return;
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
  }

  if (req.url === '/' || req.url === '/index.html') {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kant Relay</title>
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png" />
  </head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;">
    <div style="text-align:center;">
      <img src="/favicon.png" alt="Kant" style="width:96px;height:96px;border-radius:18px;" />
      <h2 style="margin:12px 0 0;">Kant Relay</h2>
      <p style="margin:8px 0 0;opacity:0.8;">Relay ready</p>
    </div>
  </body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Health/readiness endpoints for orchestrators and Prometheus scraping.
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  if (req.url === '/readyz') {
    const ready = (node as any).status === 'started';
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready }));
    return;
  }

  if (req.url === '/metrics') {
    registry.metrics().then((metrics: string) => {
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(metrics);
    }).catch(() => {
      res.writeHead(500); res.end();
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/__lab/restart' && LAB_CONTROL_TOKEN) {
    if (req.headers.authorization !== `Bearer ${LAB_CONTROL_TOKEN}`) {
      res.writeHead(403); res.end(); return;
    }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, restarting: true }));
    // Allow the response to leave the socket before process termination.
    setTimeout(() => process.exit(0), 50).unref();
    return;
  }

  // ── Admin endpoints ────────────────────────────────────────────────────────
  // Bearer token auth using the same RELAY_LAB_CONTROL_TOKEN env var.
  // These endpoints expose reservation state for ops/debugging and allow
  // soft-eviction of misbehaving peers.

  if (req.url?.startsWith('/admin/')) {
    if (!LAB_CONTROL_TOKEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'admin endpoints disabled (no control token configured)' }));
      return;
    }
    const auth = req.headers.authorization;
    if (!auth) {
      log.warn({ event: 'admin.auth.missing' }, 'admin request without auth header');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'authorization header required' }));
      return;
    }
    if (auth !== `Bearer ${LAB_CONTROL_TOKEN}`) {
      log.warn({ event: 'admin.auth.bad_token' }, 'admin request with bad token');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid authorization token' }));
      return;
    }
  }

  // GET /admin/reservations — list all active reservations
  if (req.method === 'GET' && req.url === '/admin/reservations') {
    const reservations = getActiveReservations();
    log.info({ event: 'admin.reservation.list', count: reservations.length }, 'admin: listed reservations');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: reservations.length,
      limit: 1024,
      reservations,
    }));
    return;
  }

  // GET /admin/reservations/:peerId — detailed info for one peer
  const detailMatch = req.url?.match(/^\/admin\/reservations\/([A-Za-z0-9]+)$/);
  if (req.method === 'GET' && detailMatch) {
    const peerId = detailMatch[1];
    const info = getReservation(peerId);
    if (!info) {
      log.info({ event: 'admin.reservation.get', peerId: peerId.slice(0, 12), found: false }, 'admin: reservation not found');
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'reservation not found', peerId }));
      return;
    }
    log.info({ event: 'admin.reservation.get', peerId: peerId.slice(0, 12), found: true }, 'admin: reservation fetched');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return;
  }

  // DELETE /admin/reservations/:peerId — soft-evict a peer
  const evictMatch = req.url?.match(/^\/admin\/reservations\/([A-Za-z0-9]+)$/);
  if (req.method === 'DELETE' && evictMatch) {
    const peerId = evictMatch[1];
    const evicted = evictReservation(peerId);
    if (!evicted) {
      log.info({ event: 'admin.reservation.evict', peerId: peerId.slice(0, 12), found: false }, 'admin: evict target not found');
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'reservation not found', peerId }));
      return;
    }
    const remainingCount = getReservationCount();
    log.info({ event: 'admin.reservation.evict', peerId: peerId.slice(0, 12), remainingCount }, 'admin: reservation soft-evicted');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evicted: true, peerId, remainingCount }));
    return;
  }

  if (req.method === 'POST' && req.url === '/register') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 65536; // 64KB — prevent memory exhaustion
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) {
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      const end = registerDuration.startTimer();
      try {
        const data = JSON.parse(body);
        if (!data.publicKeyHex || !data.circuitAddr || !data.sig || !data.timestamp || !data.nonce) {
          registerRequests.inc({ result: 'bad_request' });
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'missing fields' }));
          end();
          return;
        }
        // Reject stale registrations (>60s clock skew tolerance)
        if (Math.abs(Date.now() - data.timestamp) > 60000) {
          registerRequests.inc({ result: 'stale' });
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'timestamp too old or in the future' }));
          end();
          return;
        }
        // Reject replayed nonces
        if (usedNonces.has(data.nonce)) {
          registerRequests.inc({ result: 'replay' });
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'nonce already used' }));
          end();
          return;
        }
        // Verify the client signed: timestamp || nonce || circuitAddr.
        // When registering an ephemeral key, identityKeyHex carries the Ed25519
        // key used for signing; publicKeyHex is the ephemeral key being registered.
        const verifyKeyHex = data.identityKeyHex ?? data.publicKeyHex;
        const signedMsg = `${data.timestamp}|${data.nonce}|${data.circuitAddr}`;
        const pubKeyBytes = sodium.from_hex(verifyKeyHex);
        const sigBytes    = Array.isArray(data.sig) ? new Uint8Array(data.sig) : sodium.from_hex(data.sig);
        const msgBytes    = new TextEncoder().encode(signedMsg);
        if (!sodium.crypto_sign_verify_detached(sigBytes, msgBytes, pubKeyBytes)) {
          registerRequests.inc({ result: 'bad_signature' });
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'invalid signature' }));
          end();
          return;
        }
        // Record the nonce with an expiry; the age-based sweep reclaims it.
        usedNonces.set(data.nonce, Date.now() + NONCE_TTL_MS);
        const entry = {
          circuitAddr: data.circuitAddr,
          peerId: data.peerId ?? '',
          registeredAt: Date.now(),
        };
        const requestedKeys = new Set<string>([data.publicKeyHex, data.identityKeyHex].filter(Boolean));
        let newKeyCount = 0;
        for (const key of requestedKeys) {
          if (!peerRegistry.has(key)) newKeyCount++;
        }
        if (peerRegistry.size + newKeyCount > MAX_REGISTRY_ENTRIES) {
          registerRequests.inc({ result: 'registry_full' });
          res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '30' });
          res.end(JSON.stringify({ error: 'registry capacity reached' }));
          end();
          return;
        }
        // Log only when the registration is new or the address/peerId changed.
        const prev = peerRegistry.get(data.publicKeyHex);
        const changed = !prev || prev.circuitAddr !== entry.circuitAddr || prev.peerId !== entry.peerId;
        // Update the public-key entry
        peerRegistry.set(data.publicKeyHex, entry);
        // Also index by identity key when present (identity entries are marked)
        if (data.identityKeyHex) {
          const identityEntry = { ...entry, isIdentityEntry: true };
          const prevId = peerRegistry.get(data.identityKeyHex);
          const idChanged = !prevId || prevId.circuitAddr !== identityEntry.circuitAddr || prevId.peerId !== identityEntry.peerId;
          peerRegistry.set(data.identityKeyHex, identityEntry);
          // If either mapping changed, treat as changed for logging
          if (idChanged) {
            log.info({ event: 'registry.register', keyHex: data.identityKeyHex.slice(0, 12), publicKeyHex: data.publicKeyHex.slice(0, 12) }, 'identity entry registered');
          }
        }
        if (changed) log.info({ event: 'registry.register', keyHex: data.publicKeyHex.slice(0, 12) }, 'registered');
        publishRegistryMetrics();
        registerRequests.inc({ result: 'ok' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        end();
      } catch (e: any) {
        log.error({ event: 'register.error', err: String(e?.message ?? e) }, 'register handler threw');
        registerRequests.inc({ result: 'error' });
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'internal error' }));
        end();
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/lookup')) {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 65536;
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      const end = lookupDuration.startTimer();
      try {
        const data = JSON.parse(body);
        if (!data.keys || !Array.isArray(data.keys) || !data.publicKeyHex || !data.sig || !data.timestamp || !data.nonce) {
          lookupRequests.inc({ result: 'bad_request' });
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing fields' })); end(); return;
        }
        if (Math.abs(Date.now() - data.timestamp) > 60000) {
          lookupRequests.inc({ result: 'stale' });
          res.writeHead(400); res.end(JSON.stringify({ error: 'timestamp too old or in the future' })); end(); return;
        }
        if (usedNonces.has(data.nonce)) {
          lookupRequests.inc({ result: 'replay' });
          res.writeHead(400); res.end(JSON.stringify({ error: 'nonce already used' })); end(); return;
        }
        const keys: string[] = data.keys.filter(Boolean);
        if (keys.length > 100) {
          lookupRequests.inc({ result: 'too_many_keys' });
          res.writeHead(400); res.end(JSON.stringify({ error: 'max 100 keys per request' })); end(); return;
        }
        for (const key of keys) {
          if (!/^[0-9a-fA-F]{64}$/.test(key)) {
            lookupRequests.inc({ result: 'bad_key_format' });
            res.writeHead(400); res.end(JSON.stringify({ error: `invalid key format: ${key.slice(0, 12)}…` })); end(); return;
          }
        }
        // Verify requester signature: timestamp|nonce|keys.join(',')
        const signedMsg = `${data.timestamp}|${data.nonce}|${keys.join(',')}`;
        let pubKeyBytes: Uint8Array;
        try { pubKeyBytes = sodium.from_hex(data.publicKeyHex); } catch {
          lookupRequests.inc({ result: 'bad_public_key' });
          res.writeHead(400); res.end(JSON.stringify({ error: 'invalid publicKeyHex' })); end(); return;
        }
        const sigBytes = Array.isArray(data.sig) ? new Uint8Array(data.sig) : sodium.from_hex(data.sig);
        const msgBytes = new TextEncoder().encode(signedMsg);
        if (!sodium.crypto_sign_verify_detached(sigBytes, msgBytes, pubKeyBytes)) {
          lookupRequests.inc({ result: 'bad_signature' });
          res.writeHead(403); res.end(JSON.stringify({ error: 'invalid signature' })); end(); return;
        }
        usedNonces.set(data.nonce, Date.now() + NONCE_TTL_MS);
        const results: Record<string, string> = {};
        let found = 0;
        let missing = 0;
        for (const key of keys) {
          const entry = peerRegistry.get(key);
          if (entry) {
            results[key] = entry.circuitAddr;
            found++;
            // The entry is still within its TTL but the circuit behind it is
            // gone, so the sender's dial will fail with NO_RESERVATION. Wake the
            // device: without this a suspended phone is silently unreachable for
            // the whole 5-minute registry TTL.
            if (!isPeerReachable(entry.peerId)) {
              lookupStaleEntries.inc();
              log.info({ event: 'lookup.stale_entry', keyHex: key.slice(0, 12) },
                'registry hit for an unreachable peer — waking device');
              void sendPushNotification(key);
            }
          } else {
            missing++;
            // Peer is offline — send a wake ping if they have a push subscription.
            void sendPushNotification(key);
          }
        }
        lookupHits.inc(found);
        lookupMisses.inc(missing);
        lookupRequests.inc({ result: 'ok' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
        end();
      } catch {
        lookupRequests.inc({ result: 'error' });
        res.writeHead(400); res.end();
        end();
      }
    });
    return;
  }

  // Legacy unauthenticated GET /lookup — kept for backward compat during rollout,
  // returns empty results to avoid breaking old clients hard.
  if (req.method === 'GET' && req.url?.startsWith('/lookup')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
    return;
  }

  // OPK burn failure reporting — clients POST here when burnOPK() returns null
  // (OPK already consumed by a prior handshake, or missing entirely). The relay
  // is stateless wrt OPKs, so the only side effect is incrementing the counter
  // and logging. A sustained non-zero rate indicates a replay attack or OPK
  // pool exhaustion on the reporting client(s).
  if (req.method === 'POST' && req.url === '/report/opk-burn-failure') {
    let body = '';
    let bodySize = 0;
    const MAX_BODY = 4096; // small — only an opkId and reason fit
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.opkId || typeof data.opkId !== 'string') {
          res.writeHead(400); res.end(JSON.stringify({ error: 'opkId required' })); return;
        }
        const reason = (data.reason === 'already_burned' || data.reason === 'not_found') ? data.reason : 'unknown';
        opkBurnFailures.inc();
        // Log without the full opkId (peer-scoped timing/PII concerns) and
        // without any headers (already redacted via pino redact list).
        log.warn({ event: 'opk.burn.failure', reason, opkIdPrefix: data.opkId.slice(0, 8) },
          'OPK burn returned null (already consumed or missing)');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // ── Push notification endpoints ─────────────────────────────────────────────────────────────

  if (req.method === 'GET' && req.url === '/push/vapid-public-key') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ key: VAPID_PUBLIC_KEY }));
    return;
  }

  if (req.method === 'OPTIONS' && req.url?.startsWith('/push/')) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type' });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/push/subscribe') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      try {
        const { identityKeyHex, token, type } = JSON.parse(body);
        if (!identityKeyHex || !token || !type) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'missing fields' })); return;
        }
        if (type === 'fcm') {
          // Forward FCM token to the push proxy — relay never holds Firebase credentials.
          if (PUSH_PROXY_URL) {
            const registered = await callPushProxy('/register', 'POST', JSON.stringify({ identityKeyHex, token }));
            if (!registered.ok) {
              res.writeHead(502); res.end(JSON.stringify({ error: 'push proxy unavailable' })); return;
            }
          } else {
            // Accepting the token here would report success to a device that can
            // never actually be woken. Fail loudly so the operator sees it.
            log.error({ event: 'push.subscribe_rejected', key: identityKeyHex.slice(0, 12) },
              'FCM subscribe rejected: PUSH_PROXY_URL is not configured on this relay');
            res.writeHead(501, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'relay has no push proxy configured' }));
            return;
          }
          // Also keep a local record so sendPushNotification knows to call the proxy for this key.
          pushSubscriptions.set(identityKeyHex, { type: 'fcm', token });
        } else if (type === 'webpush') {
          const sub = JSON.parse(token);
          pushSubscriptions.set(identityKeyHex, { type: 'webpush', subscription: sub });
        } else {
          res.writeHead(400); res.end(JSON.stringify({ error: 'unknown type' })); return;
        }
        publishPushMetrics();
        log.info({ event: 'push.subscribe', key: identityKeyHex.slice(0, 12), type }, 'push subscription registered');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/push/unsubscribe') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      try {
        const { identityKeyHex } = JSON.parse(body);
        if (identityKeyHex) {
          pushSubscriptions.delete(identityKeyHex);
          lastWakeAt.delete(identityKeyHex);
          publishPushMetrics();
          // Also deregister from the proxy
          if (PUSH_PROXY_URL) {
            void callPushProxy('/register', 'DELETE', JSON.stringify({ identityKeyHex }));
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const HTTP_BIND = process.env.RELAY_HTTP_BIND ?? '0.0.0.0';
httpServer.listen(RELAY_INFO_PORT, HTTP_BIND, () => {
  log.info({ event: 'http.started', bind: HTTP_BIND, port: RELAY_INFO_PORT, endpoints: ['/relay-info', '/healthz', '/readyz', '/metrics'] }, 'HTTP info server started');
});

// Graceful shutdown — drain existing connections before exiting.
process.on('SIGTERM', async () => {
  log.info({ event: 'shutdown.start', signal: 'SIGTERM' }, 'received SIGTERM');
  relayReady.set({ gate: 'not_ready' }, 1);
  relayReady.set({ gate: 'ready' }, 0);
  await node.stop();
  httpServer.close(() => {
    log.info({ event: 'shutdown.complete' }, 'server closed');
    process.exit(0);
  });
  // Force exit if graceful close stalls.
  setTimeout(() => { log.warn({ event: 'shutdown.force' }, 'forced exit'); process.exit(1); }, 10000).unref();
});

process.on('SIGINT', async () => {
  log.info({ event: 'shutdown.start', signal: 'SIGINT' }, 'received SIGINT');
  relayReady.set({ gate: 'not_ready' }, 1);
  relayReady.set({ gate: 'ready' }, 0);
  await node.stop();
  httpServer.close(() => {
    log.info({ event: 'shutdown.complete' }, 'server closed');
    process.exit(0);
  });
  setTimeout(() => { log.warn({ event: 'shutdown.force' }, 'forced exit'); process.exit(1); }, 10000).unref();
});
