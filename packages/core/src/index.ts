/**
 * Kant Core — Crypto & P2P primitives (Phase 0)
 */

import { getSodium } from './sodium.js';
import { createLibp2p, type Libp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import { FaultTolerance } from '@libp2p/interface';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';

export { hasIdentity, createIdentity, unlockIdentity, wipeIdentity, deriveKey } from './identity.js';
export type { StoredKeypair, UnlockedIdentity } from './identity.js';
export {
  generateX25519Keypair, ed25519ToX25519, ed25519PubToX25519,
  x3dhSend, x3dhReceive,
  initSenderRatchet, initReceiverRatchet,
  ratchetEncrypt, ratchetDecrypt
} from './ratchet.js';
export type { X25519Keypair, X3DHPublicBundle, X3DHPrivateBundle, RatchetState, EncryptedMessage } from './ratchet.js';
export { saveRatchet, loadRatchets, deleteRatchet } from './ratchetStore.js';
export { fetchPreKeyBundle, buildPrivateBundle, buildPublicBundle, getOrCreateSPK, findSPKByPublicKey, replenishOPKPool, reserveOPK, getOPK, burnOPK, PREKEY_PROTOCOL } from './prekey.js';

export { addContact, getContacts, getContact, deleteContact, generateQR, parseQR, updateContactAddr, setContactTrust, normalizeContact } from './contacts.js';
export type { Contact } from './contacts.js';

export { saveMessage, setMessageStatus, getConversation, getAllConversationHeaders, getAllConversations, deleteConversation, incrementUnread, clearUnread, getAllUnread } from './messages.js';
export type { StoredMessage, ConversationHeader, Conversation, MessageStatus, MessageAttachment } from './messages.js';

export { startDiscovery, getKnownPeers } from './discovery.js';
export type { DiscoveredPeer, PeerDiscoveryHandler } from './discovery.js';

export { enqueue, dequeue, getPendingForContact, startQueueRetry } from './queue.js';
export type { QueuedMessage, SendFn } from './queue.js';

export {
  GROUP_PROTOCOL,
  createGroup, getGroups, getGroup, saveGroup, deleteGroup,
  sendGroupMessage, sendGroupPresence, handleIncomingGroupMsg,
  distributeGroupKey, rotateGroupKey,
  sendGroupKeyToMember, registerGroupHandler,
  processDeliveryQueue, getDeliveryQueueStatus,
  encryptGroupMessage, decryptGroupMessage,
  saveGroupMessage, getGroupMessages,
  handleIncomingGroupKey,
  encodeGroupText, decodeGroupText,
} from './groups.js';
export type { Group, GroupMember, GroupMessage, GroupEvent, GroupEventHandler, StoredGroupConversation, GroupReplyRef } from './groups.js';

export { sendOnion, registerOnionHandler, pickHops, unpadPayload, COVER_TYPE } from './onion.js';
export type { OnionHop } from './onion.js';

export { testTorProxy, torWebSocketFactory, applyTorTransport } from './tor.js';
export type { TorConfig } from './tor.js';
export { DEFAULT_TOR_CONFIG } from './tor.js';

export {
  FILE_PROTOCOL,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_WINDOW,
  DEFAULT_MAX_CONCURRENT_PER_PEER,
  DEFAULT_MAX_CONCURRENT_TOTAL,
  COMMUNITY_MAX_FILE_SIZE,
  ENTERPRISE_MAX_FILE_SIZE,
  generateFileKey,
  encryptChunk,
  decryptChunk,
  sendFile,
  registerFileHandler,
  saveFileBlob,
  getFileBlob,
} from './files.js';
export type {
  FileMeta,
  FileAccept,
  FileReject,
  FileChunk,
  FileChunkAck,
  FileAck,
  FileMessage,
  StoredFile,
  StoredFileBlob,
  FileProgressCallback,
  SendFileOptions,
  ReceiveFileCallbacks,
  ReceiveFileOptions,
} from './files.js';

export {
  verifyLicense,
  deactivateLicense,
  isLicenseActive,
  isFeatureAvailable,
  getLicenseTier,
  getActiveLicense,
  getActiveFeatures,
  encodeLicenseKey,
  signLicense,
  COMMUNITY_FEATURES,
  PROFESSIONAL_FEATURES,
  ENTERPRISE_FEATURES,
} from './license.js';
export type { License, LicenseTier, LicenseFeatures } from './license.js';

export const RECEIPT_PROTOCOL = '/kant/receipt/1.0.0';

export const PING_PROTOCOL = '/kant/ping/1.0.0';

// ── Core log sink ───────────────────────────────────────────────────────────
// Transport-level events (dial attempts, retries, onion forwarding, inbound
// frames) happen inside core, below the React layer, so they normally only
// reach the browser devtools console. The app registers a sink via
// setCoreLogger so this detail also lands in the in-app DebugLog — essential
// for diagnosing flaky-circuit / lost-message issues on machines where you
// only have the in-app log to look at.
export type CoreLogFn = (msg: string) => void;
let __coreLog: CoreLogFn | null = null;
export function setCoreLogger(fn: CoreLogFn | null): void { __coreLog = fn; }
export function clog(msg: string): void {
  try { __coreLog?.(msg); } catch { /* sink must never throw into core */ }
  try { console.log('[kant]', msg); } catch { /* no console */ }
}

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
}

export async function generateKeypair(_password: string): Promise<Keypair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicKeyHex: sodium.to_hex(kp.publicKey)
  };
}

export type PingHandler = (fromPeerId: string, message: string) => void;
export type GroupMsgHandler = (payload: any) => void;

/** Assemble chunks into a single Uint8Array */
function assembleChunks(chunks: Uint8Array[]): Uint8Array {
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { total.set(c, offset); offset += c.length; }
  return total;
}

/** Hard cap on a single length-prefixed frame (16 MiB). A 4-byte length header
 *  can claim up to 4 GiB; without this cap a peer could force us to buffer that
 *  much memory. Rejected frames close the stream. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * Read a length-prefixed message from a stream.
 * Wire format: [4-byte big-endian length] [payload bytes]
 * Resolves when the full payload has been received.
 * Rejects if the stream closes before the expected number of bytes arrive.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let expectedLen: number | null = null;
    let received = 0;

    function tryResolve() {
      // Need at least 4 bytes for the length header
      if (expectedLen === null) {
        if (received < 4) return;
        const header = assembleChunks(chunks);
        const view = new DataView(header.buffer, header.byteOffset, 4);
        expectedLen = view.getUint32(0, false); // big-endian
        if (expectedLen > MAX_FRAME_BYTES) {
          reject(new Error(`Frame too large: ${expectedLen} > ${MAX_FRAME_BYTES}`));
          return true;
        }
        // Remove header bytes from tracking
        // Split the first chunk: header (4 bytes) + remaining payload
        const firstPayload = header.subarray(4);
        chunks.length = 0;
        received = firstPayload.length;
        if (received > 0) chunks.push(firstPayload);
      }

      // Check if we have the full payload
      if (received >= expectedLen) {
        const payload = assembleChunks(chunks).subarray(0, expectedLen);
        resolve(new TextDecoder().decode(payload));
        return true;
      }
      return false;
    }

    stream.addEventListener('message', (evt: any) => {
      const data = evt.data instanceof Uint8Array ? evt.data : evt.data.subarray();
      chunks.push(data);
      received += data.length;
      tryResolve();
    });

    stream.addEventListener('remoteCloseWrite', () => {
      if (!tryResolve()) {
        reject(new Error(`Stream closed early: got ${received} bytes, expected ${expectedLen ?? 'at least 4'}`));
      }
    });

    stream.addEventListener('close', (evt: any) => {
      if (evt.error) reject(evt.error);
      else if (!tryResolve()) {
        reject(new Error(`Stream closed early: got ${received} bytes, expected ${expectedLen ?? 'at least 4'}`));
      }
    });
  });
}

import type { StoredKeypair } from './identity.js';
import { registerPrekeyHandler } from './prekey.js';
import { registerOnionHandler } from './onion.js';
import { applyTorTransport } from './tor.js';
import type { TorConfig } from './tor.js';
import { withSendLock, getOrDialPeer } from './send-lock.js';

export type ReceiptHandler = (fromPeerId: string, receipt: {msgId: string, status: 'sending' | 'sent' | 'delivered' | 'read', fromPubKeyHex: string}) => void;

export async function createNode(onPing?: PingHandler, onReceipt?: ReceiptHandler, relayAddr?: string, identity?: StoredKeypair, onGroupMsg?: GroupMsgHandler, torConfig?: TorConfig): Promise<Libp2p> {
  console.log('[createNode] Starting, relay:', relayAddr, 'tor:', torConfig?.enabled ? `socks5://${torConfig.socksHost}:${torConfig.socksPort}` : 'off');

  // Derive a deterministic libp2p PrivateKey from the identity keypair so the
  // circuit address is stable across restarts — same identity = same PeerID.
  // libp2p v3 takes `privateKey` (a PrivateKey object), not a PeerId.
  let privateKey: any = undefined;
  if (identity) {
    // libsodium Ed25519 private key = 64 bytes: first 32 are the seed.
    // libp2p v3 expects a PrivateKey object (not raw/protobuf bytes) so it can
    // read .publicKey/.type when deriving the PeerId. Deterministic from the
    // seed → stable PeerID/circuit address across restarts.
    const seed = identity.privateKey.slice(0, 32);
    privateKey = await generateKeyPairFromSeed('Ed25519', seed);
  }

  // Apply Tor SOCKS5 proxy to WebSocket transport if enabled
  const wsOpts = torConfig?.enabled
    ? applyTorTransport(torConfig, {})
    : {};

  const node = await createLibp2p({
    ...(privateKey ? { privateKey } : {}),
    addresses: {
      // This is a known, configured relay.  Use its full path when requesting
      // a reservation rather than bare `/p2p-circuit`, which relies on ambient
      // relay discovery and can leave browser clients connected but never
      // reserved.  The resulting advertised address is
      // <relay>/p2p-circuit/p2p/<our-peer-id>.
      listen: relayAddr ? [`${relayAddr}/p2p-circuit`] : []
    },
    // The circuit-relay reservation is registered as a listen address. In this
    // environment the reservation handshake is intermittently flaky (the relay's
    // reservation response occasionally fails to decode). Under the default
    // FATAL_ALL, a single failed reservation aborts node startup entirely, so the
    // whole connect drops to "Offline". NO_FATAL lets the node start anyway; the
    // circuit-relay-v2 reservation store then keeps retrying in the background
    // until a reservation succeeds, instead of failing hard on the first attempt.
    transportManager: { faultTolerance: FaultTolerance.NO_FATAL },
    transports: [
      webSockets(wsOpts),
      // We already listen on one configured relay. Suppress topology discovery:
      // if it reserves this relay first, the explicit listener sees an existing
      // reservation but never publishes its /p2p-circuit address.
      circuitRelayTransport({
        discoveryFilter: { has: () => true, add: () => {}, remove: () => {} }
      })
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    connectionGater: { denyDialMultiaddr: () => false },
    // The relay does not speak /ipfs/ping/1.0.0. The default connection monitor
    // pings every peer with that protocol and kills the connection when it gets
    // no response — causing the Android client to drop its relay reservation
    // every 10-30 seconds. Disable it; Kant uses its own PING_PROTOCOL.
    connectionMonitor: { enabled: false },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await node.handle(PING_PROTOCOL, async (stream: any, connection: any) => {
    const message = await readAll(stream);
    const fromPeer = connection.remotePeer.toString();
    let kind = 'raw';
    try { kind = JSON.parse(message)?.type ?? (JSON.parse(message)?.ciphertext ? 'ciphertext' : 'raw'); } catch { /* non-JSON */ }
    clog(`PING in ← ${fromPeer.slice(0, 12)}… ${message.length}B [${kind}]`);
    // Route group-msg payloads to the group handler, everything else to onPing
    try {
      const parsed = JSON.parse(message);
      if ((parsed.type === 'group-msg' || parsed.type === 'group-presence') && onGroupMsg) {
        onGroupMsg(parsed);
        // Kant sends unidirectional frames.  The caller closes its write side
        // immediately and never consumes a reply; sending a pong here races
        // that close on circuit-relay/yamux and was corrupting later streams.
        await stream.close();
        return;
      }
    } catch { /* not JSON or not group-msg — fall through */ }
    onPing?.(connection.remotePeer.toString(), message);
    // Deliberately no response. Delivery is confirmed by a separate receipt
    // only after the encrypted payload is processed by the recipient.
    await stream.close();
  }, { runOnLimitedConnection: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await node.handle(RECEIPT_PROTOCOL, async (stream: any, connection: any) => {
    const receiptJson = await readAll(stream);
    try {
      const receipt = JSON.parse(receiptJson) as {msgId: string, status: 'sending' | 'sent' | 'delivered' | 'read', fromPubKeyHex: string};
      onReceipt?.(connection.remotePeer.toString(), receipt);
    } catch {}
    await stream.close();
  }, { runOnLimitedConnection: true });

  await node.start();
  console.log('[createNode] Started, peerId:', node.peerId.toString());

  if (relayAddr) {
    let dialError: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await node.dial(multiaddr(relayAddr));
        console.log('[createNode] Relay dialled:', relayAddr.slice(0, 60));
        dialError = undefined;
        break;
      } catch (e: any) {
        dialError = e;
        const detail = e?.message || e?.error?.message || e?.type || String(e);
        console.warn(`[createNode] Relay dial failed ${attempt}/4:`, detail);
        if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 750));
      }
    }
    if (dialError) {
      console.warn('[createNode] Relay unavailable after retries; reservation store will continue retrying');
    }
  }

  if (identity) {
    await registerPrekeyHandler(node, identity);
    // Onion forwarding needs our X25519 secret (derived from identity) to peel
    // the layer addressed to us. Without an identity we can't participate.
    await registerOnionHandler(node, identity);
  }
  return node;
}

function relayBaseUrl(httpPort?: number, explicitUrl?: string): string {
  if (explicitUrl) return explicitUrl.replace(/\/$/, '');
  const envUrl = (import.meta as any).env?.VITE_RELAY_URL;
  if (envUrl) return (envUrl as string).replace(/\/$/, '');
  const envPort = (import.meta as any).env?.VITE_RELAY_HTTP_PORT;
  const port = httpPort ?? (envPort ? parseInt(envPort) : 3001);
  return `http://127.0.0.1:${port}`;
}

export async function getRelayInfo(httpPort?: number, explicitUrl?: string): Promise<{ peerId: string; multiaddr: string } | null> {
  const base = explicitUrl ?? (import.meta as any).env?.VITE_RELAY_URL;
  const urls: string[] = base
    ? [`${(base as string).replace(/\/$/, '')}/relay-info`]
    : (httpPort
        ? [`http://127.0.0.1:${httpPort}/relay-info`]
        : [3001, 3003, 3005].map(p => `http://127.0.0.1:${p}/relay-info`));
  
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status} ${res.statusText}`);
        continue;
      }
      const data = await res.json();
      const safeAddr = String(data.multiaddr ?? '').replace(/[\r\n]/g, '').slice(0, 200);
      console.log('[getRelayInfo] relay:', safeAddr);
      return data;
    } catch (e: any) {
      errors.push(`${url}: ${e?.message || e}`);
    }
  }
  
  if (errors.length > 0) {
    // Sanitize before logging to prevent log injection from relay error messages
    console.error('[getRelayInfo] All attempts failed:', errors.map(e => e.replace(/[\r\n]/g, ' ').slice(0, 200)));
  }
  return null;
}

export async function connectToRelay(node: Libp2p, relayAddr: string): Promise<void> {
  console.log('Connecting to relay:', relayAddr);
  await node.dial(multiaddr(relayAddr));
  await new Promise(r => setTimeout(r, 1500)); // Wait for identify
}

export async function sendReceipt(node: Libp2p, peerMultiaddr: string, receipt: {msgId: string, status: 'sending' | 'sent' | 'delivered' | 'read', fromPubKeyHex?: string}): Promise<void> {
  // A receipt often races a presence heartbeat or the next encrypted payload.
  // libp2p circuit stream negotiation is not safe under those concurrent
  // dials, so share the per-destination lock used by ping/prekey/onion sends.
  await withSendLock(node, peerMultiaddr, async () => {
    const receiptJson = JSON.stringify(receipt);
    const conn = await getOrDialPeer(node, peerMultiaddr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await conn.newStream(RECEIPT_PROTOCOL, { runOnLimitedConnection: true });
    const payloadBytes = new TextEncoder().encode(receiptJson);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, payloadBytes.length, false);
    const framed = new Uint8Array(4 + payloadBytes.length);
    framed.set(header); framed.set(payloadBytes, 4);
    stream.send(framed);
    await stream.close();
  });
}

export async function sendPing(node: Libp2p, peerMultiaddr: string, message: string): Promise<string> {
  let kind = 'raw';
  try { kind = JSON.parse(message)?.type ?? 'raw'; } catch { /* non-JSON */ }
  const dst = (peerMultiaddr.split('/p2p/').pop() ?? peerMultiaddr).slice(0, 12);
  try {
    return await withSendLock(node, peerMultiaddr, async () => {
      const conn = await getOrDialPeer(node, peerMultiaddr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream: any = await conn.newStream(PING_PROTOCOL, { runOnLimitedConnection: true });
      const payloadBytes = new TextEncoder().encode(message);
      const header = new Uint8Array(4);
      new DataView(header.buffer).setUint32(0, payloadBytes.length, false);
      const framed = new Uint8Array(4 + payloadBytes.length);
      framed.set(header); framed.set(payloadBytes, 4);
      stream.send(framed);
      await stream.close();
      clog(`PING out → ${dst}… ${message.length}B [${kind}] ok`);
      return '';
    });
  } catch (e: any) {
    clog(`PING out → ${dst}… [${kind}] FAIL: ${String(e?.message ?? e).replace(/[\r\n]/g, ' ').slice(0, 120)}`);
    throw e;
  }
}

export async function registerWithRelay(httpPort: number, publicKeyHex: string, circuitAddr: string, clientPeerId: string, privateKey: Uint8Array, explicitUrl?: string, identityOverride?: { publicKeyHex: string; privateKey: Uint8Array }): Promise<void> {
  const sodium = await getSodium();
  const timestamp = Date.now();
  const nonce = sodium.to_hex(sodium.randombytes_buf(16));
  const signedMsg = `${timestamp}|${nonce}|${circuitAddr}`;
  // When registering an ephemeral key, sign with the Ed25519 identity key.
  const signingKey = identityOverride?.privateKey ?? privateKey;
  const sig = sodium.crypto_sign_detached(new TextEncoder().encode(signedMsg), signingKey);
  const body: Record<string, unknown> = { publicKeyHex, circuitAddr, peerId: clientPeerId, timestamp, nonce, sig: Array.from(sig) };
  if (identityOverride) body.identityKeyHex = identityOverride.publicKeyHex;
  const res = await fetch(`${relayBaseUrl(httpPort, explicitUrl)}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).replace(/[\r\n]/g, ' ').slice(0, 200);
    throw new Error(`relay registration rejected (${res.status})${detail ? `: ${detail}` : ''}`);
  }
}

export async function lookupPeers(httpPort: number, publicKeyHexes: string[], explicitUrl?: string, identity?: { publicKeyHex: string; privateKey: Uint8Array }): Promise<Record<string, string>> {
  if (publicKeyHexes.length === 0) return {};
  try {
    const base = relayBaseUrl(httpPort, explicitUrl);
    // Authenticated POST lookup
    if (identity) {
      const sodium = await getSodium();
      const timestamp = Date.now();
      const nonce = sodium.to_hex(sodium.randombytes_buf(16));
      const signedMsg = `${timestamp}|${nonce}|${publicKeyHexes.join(',')}`;
      const sig = sodium.crypto_sign_detached(new TextEncoder().encode(signedMsg), identity.privateKey);
      const res = await fetch(`${base}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: publicKeyHexes,
          publicKeyHex: identity.publicKeyHex,
          timestamp,
          nonce,
          sig: Array.from(sig),
        }),
      });
      if (!res.ok) return {};
      return await res.json();
    }
    // Unauthenticated fallback (returns empty — relay rejects GET lookups)
    const res = await fetch(`${base}/lookup?keys=${publicKeyHexes.join(',')}`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export function ping(): string {
  return 'Kant Phase 0: P2P crypto foundation ready';
}
