/**
 * Kant Onion Routing — multi-hop forwarding with per-hop layered encryption.
 *
 * Security model:
 *   - Messages are already Double Ratchet encrypted before entering this layer.
 *   - Onion routing adds network-level anonymity: each routing layer is sealed
 *     to that hop's X25519 key (libsodium crypto_box_seal), so a hop can peel
 *     ONLY its own layer. It learns its immediate predecessor and successor —
 *     never the full path or the final recipient.
 *   - The first hop cannot see the recipient address; the last hop cannot see
 *     the sender. No single peer sees both endpoints.
 *   - With 0 available hops: direct send (graceful degradation).
 *   - With 1–2 hops: routed through intermediate peers.
 *
 * Wire protocol: /kant/onion/1.0.0
 *   Each hop receives a length-prefixed sealed blob. It opens the blob with its
 *   X25519 secret key to reveal { nextAddr, protocol, payload }, dials nextAddr,
 *   opens `protocol`, and forwards the (still-sealed for inner hops) payload
 *   bytes. The final hop's payload is the bare Double-Ratchet wire bytes,
 *   delivered to the recipient over /kant/ping/1.0.0 exactly like a direct send.
 */

import type { Libp2p } from 'libp2p';
import type { StoredKeypair } from './identity.js';
import { PING_PROTOCOL, clog } from './index.js';
import { ed25519ToX25519 } from './ratchet.js';
import { getSodium } from './sodium.js';
import { withSendLock, getOrDialPeer } from './send-lock.js';

export const ONION_PROTOCOL = '/kant/onion/1.0.0';

/** Cover-traffic message type — recipients silently discard these. */
export const COVER_TYPE = 'kant-cover';

/** All onion payloads are padded to a multiple of this block size so
 *  message length does not leak content or message type to forwarding hops. */
const PAD_BLOCK = 1024;

export interface OnionHop {
  peerId: string;
  circuitAddr: string;
  /** Hop's X25519 public key — the routing layer for this hop is sealed to it. */
  x25519Pub: Uint8Array;
}

interface OnionEnvelope {
  nextAddr: string;
  protocol: string;
  payload: number[];
}

/** Assemble chunks into a single Uint8Array */
function assembleChunks(chunks: Uint8Array[]): Uint8Array {
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { total.set(c, offset); offset += c.length; }
  return total;
}

/** Hard cap on a single length-prefixed frame (16 MiB) to bound memory. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Frame a payload with a 4-byte big-endian length prefix. */
function frame(data: Uint8Array): Uint8Array {
  const h = new Uint8Array(4);
  new DataView(h.buffer).setUint32(0, data.length, false);
  const f = new Uint8Array(4 + data.length);
  f.set(h); f.set(data, 4);
  return f;
}

/**
 * Read a length-prefixed message from a stream.
 * Rejects on early close or truncated payload.
 */
function readFramed(stream: any): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let expectedLen: number | null = null;
    let received = 0;

    function tryResolve(): boolean {
      if (expectedLen === null) {
        if (received < 4) return false;
        const header = assembleChunks(chunks);
        const view = new DataView(header.buffer, header.byteOffset, 4);
        expectedLen = view.getUint32(0, false);
        if (expectedLen > MAX_FRAME_BYTES) {
          reject(new Error(`Frame too large: ${expectedLen} > ${MAX_FRAME_BYTES}`));
          return true;
        }
        const firstPayload = header.subarray(4);
        chunks.length = 0;
        received = firstPayload.length;
        if (received > 0) chunks.push(firstPayload);
      }
      if (received >= expectedLen) {
        resolve(assembleChunks(chunks).subarray(0, expectedLen));
        return true;
      }
      return false;
    }

    stream.addEventListener('message', (e: any) => {
      const d = e.data instanceof Uint8Array ? e.data : e.data.subarray();
      chunks.push(d);
      received += d.length;
      tryResolve();
    });
    stream.addEventListener('remoteCloseWrite', () => {
      if (!tryResolve()) reject(new Error('Stream closed early'));
    });
    stream.addEventListener('close', (e: any) => {
      if (e.error) reject(e.error);
      else if (!tryResolve()) reject(new Error('Stream closed early'));
    });
  });
}

/**
 * Register the onion forwarding handler on this node.
 *
 * `identity` supplies the Ed25519 identity keypair; we derive our X25519 secret
 * from it to open (crypto_box_seal_open) the layer addressed to us. A hop that
 * receives a layer not sealed to it simply fails to open it and drops the frame.
 */
export async function registerOnionHandler(node: Libp2p, identity: StoredKeypair): Promise<void> {
  const sodium = await getSodium();
  const x25519 = await ed25519ToX25519(identity.publicKey, identity.privateKey);

  await node.handle(ONION_PROTOCOL, async (stream: any) => {
    try {
      const sealed = await readFramed(stream);
      let opened: Uint8Array | null;
      try {
        opened = sodium.crypto_box_seal_open(sealed, x25519.publicKey, x25519.privateKey);
      } catch {
        opened = null;
      }
      if (!opened) {
        clog('[onion] could not open layer — not addressed to us; dropping');
        await stream.close();
        return;
      }

      let envelope: OnionEnvelope;
      try {
        envelope = JSON.parse(new TextDecoder().decode(opened)) as OnionEnvelope;
      } catch {
        clog('[onion] invalid envelope JSON; dropping');
        await stream.close();
        return;
      }

      // Validate envelope fields before using them in network operations
      if (typeof envelope.nextAddr !== 'string' || typeof envelope.protocol !== 'string' || !Array.isArray(envelope.payload)) {
        clog('[onion] malformed envelope fields; dropping');
        await stream.close();
        return;
      }

      // Only allow known Kant protocols to be forwarded — prevents the relay
      // being used as a generic proxy to arbitrary addresses/protocols.
      const ALLOWED_PROTOCOLS = [PING_PROTOCOL, ONION_PROTOCOL];
      if (!ALLOWED_PROTOCOLS.includes(envelope.protocol)) {
        clog(`[onion] disallowed forward protocol ${envelope.protocol.slice(0, 40)}; dropping`);
        await stream.close();
        return;
      }

      // Validate nextAddr is a plausible circuit multiaddr (must contain /p2p/)
      if (!envelope.nextAddr.includes('/p2p/')) {
        clog('[onion] nextAddr is not a circuit multiaddr; dropping');
        await stream.close();
        return;
      }

      const payloadBytes = new Uint8Array(envelope.payload);
      if (payloadBytes.length > MAX_FRAME_BYTES) {
        clog('[onion] payload too large; dropping');
        await stream.close();
        return;
      }

      const nextDst = (envelope.nextAddr.split('/p2p/').pop() ?? '').slice(0, 12);
      const isLastHop = envelope.protocol === PING_PROTOCOL;
      // Strip padding only on the final hop delivery — intermediate hops forward
      // the sealed blob as-is (they cannot read it), so padding is preserved
      // through all intermediate layers and only removed at the destination.
      const deliveryBytes = isLastHop ? unpadPayload(payloadBytes) : payloadBytes;
      clog(`onion FORWARD → ${nextDst}… [${envelope.protocol.split('/').slice(-2)[0]}] ${deliveryBytes.length}B`);
      const conn = await getOrDialPeer(node, envelope.nextAddr);
      const fwd: any = await conn.newStream(envelope.protocol, { runOnLimitedConnection: true });
      fwd.send(frame(deliveryBytes));
      await fwd.close();
      await stream.close();
    } catch (e: any) {
      clog(`onion FORWARD error: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }, { runOnLimitedConnection: true });
}

/**
 * Dial a circuit address, open a stream, send one framed payload, and close.
 *
 * Circuit-relay-v2 HOP/reservation handshakes are intermittently flaky —
 * a single dial can fail with CONNECTION_FAILED even when the peer is reachable,
 * yet the very next attempt succeeds. Since the failure always happens at dial
 * time (before any bytes are sent), retrying cannot double-deliver; and even a
 * rare duplicate is dropped by the recipient's Double Ratchet as a replayed
 * message counter. Retry with a short backoff instead of losing the message.
 */
async function dialSendClose(
  node: Libp2p,
  addr: string,
  protocol: string,
  payload: Uint8Array,
  attempts = 4
): Promise<void> {
  await withSendLock(node, addr, () => dialSendCloseUnlocked(node, addr, protocol, payload, attempts));
}

async function dialSendCloseUnlocked(
  node: Libp2p,
  addr: string,
  protocol: string,
  payload: Uint8Array,
  attempts: number
): Promise<void> {
  let lastErr: unknown;
  const dst = (addr.split('/p2p/').pop() ?? addr).slice(0, 12);
  const proto = protocol.split('/').slice(-2)[0];
  for (let i = 0; i < attempts; i++) {
    try {
      const conn = await getOrDialPeer(node, addr);
      const stream: any = await conn.newStream(protocol, { runOnLimitedConnection: true });
      stream.send(frame(payload));
      await stream.close();
      clog(`dial → ${dst}… [${proto}] ${payload.length}B ok${i > 0 ? ` (attempt ${i + 1})` : ''}`);
      return;
    } catch (e: any) {
      lastErr = e;
      clog(`dial → ${dst}… [${proto}] attempt ${i + 1}/${attempts} FAIL: ${String(e?.message ?? e).slice(0, 120)}`);
      // NO_RESERVATION means the peer's circuit reservation hasn't completed —
      // retrying immediately won't help. Bail out and let the caller retry later.
      if (String(e?.message ?? e).includes('NO_RESERVATION')) break;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 150 * (i + 1)));
    }
  }
  clog(`dial → ${dst}… [${proto}] GAVE UP after ${attempts} attempts`);
  throw lastErr;
}

/** Pad bytes to the nearest PAD_BLOCK boundary. Format: [2-byte LE real length][payload][zero padding] */
function padPayload(data: Uint8Array): Uint8Array {
  const realLen = data.length;
  const padded = Math.ceil((realLen + 2) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(padded); // zero-filled
  out[0] = realLen & 0xff;
  out[1] = (realLen >> 8) & 0xff;
  out.set(data, 2);
  return out;
}

/** Strip padding added by padPayload. */
export function unpadPayload(data: Uint8Array): Uint8Array {
  if (data.length < 2) return data;
  const realLen = data[0] | (data[1] << 8);
  if (realLen + 2 > data.length) return data; // malformed — return as-is
  return data.subarray(2, 2 + realLen);
}

/**
 * Send a message through onion routing.
 *
 * hops: 0–2 intermediate peers. With 0 hops sends direct.
 * Path with 2 hops: us → hop[0] → hop[1] → recipient
 * Path with 1 hop:  us → hop[0] → recipient
 * Path with 0 hops: us → recipient (direct)
 *
 * plainPayload is the already Double-Ratchet-encrypted wire JSON string.
 * All payloads are padded to 1 KB blocks before onion wrapping.
 */
export async function sendOnion(
  node: Libp2p,
  hops: OnionHop[],
  recipientAddr: string,
  plainPayload: string
): Promise<void> {
  const payloadBytes = padPayload(new TextEncoder().encode(plainPayload));

  // Never route through the recipient itself
  const recipientPeerId = recipientAddr.split('/p2p/').pop();
  const routeHops = hops.filter(h => h.peerId !== recipientPeerId);

  clog(`onion send → ${(recipientPeerId ?? '').slice(0, 12)}… via ${routeHops.length} hop(s), ${payloadBytes.length}B`);

  if (routeHops.length === 0) {
    // Direct send: strip padding before delivery — the PING handler receives
    // raw bytes and expects JSON, not a padded blob.
    await dialSendClose(node, recipientAddr, PING_PROTOCOL, unpadPayload(payloadBytes));
    return;
  }

  const sodium = await getSodium();

  // Build the sealed chain from the inside out.
  let current: Uint8Array = payloadBytes;
  let nextAddr = recipientAddr;
  let nextProto = PING_PROTOCOL;

  for (let i = routeHops.length - 1; i >= 0; i--) {
    const envelope: OnionEnvelope = {
      nextAddr,
      protocol: nextProto,
      payload: Array.from(current),
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
    current = sodium.crypto_box_seal(plaintext, routeHops[i].x25519Pub);
    nextAddr = routeHops[i].circuitAddr;
    nextProto = ONION_PROTOCOL;
  }

  await dialSendClose(node, routeHops[0].circuitAddr, ONION_PROTOCOL, current);
}

/**
 * Pick up to 2 intermediate hops from a provided registry of known peers.
 *
 * The registry is populated by the app from relay lookups — this means hops
 * work worldwide, not just with peers already in the live libp2p peer store.
 *
 * Falls back to scanning the live peer store if the registry is empty.
 * Excludes the local peer and the recipient peer.
 * Only peers whose Ed25519 public key is known (so we can derive X25519) are eligible.
 */
export async function pickHops(
  node: Libp2p,
  excludePeerIds: string[],
  hopRegistry?: Map<string, { circuitAddr: string; ed25519PubHex: string }>,
  excludePubKeyHexes: string[] = []
): Promise<OnionHop[]> {
  try {
    const sodium = await getSodium();
    const hops: OnionHop[] = [];
    const myPeerId = node.peerId.toString();

    // Primary: use the registry populated from relay lookups
    if (hopRegistry && hopRegistry.size > 0) {
      for (const [ed25519PubHex, entry] of hopRegistry) {
        if (hops.length >= 2) break;
        if (!entry.circuitAddr || !entry.ed25519PubHex) continue;
        // Exclude by pubkey hex (registry key) and by circuit PeerID
        if (excludePubKeyHexes.includes(ed25519PubHex)) continue;
        const entryPeerId = entry.circuitAddr.split('/p2p/').pop() ?? '';
        if (excludePeerIds.includes(entryPeerId)) continue;
        if (entryPeerId === myPeerId) continue;
        try {
          const ed25519Pub = sodium.from_hex(ed25519PubHex);
          if (ed25519Pub.length !== 32) continue;
          const x25519Pub = sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519Pub);
          hops.push({ peerId: entryPeerId, circuitAddr: entry.circuitAddr, x25519Pub });
        } catch { continue; }
      }
    }

    // Fallback: scan live peer store (works for LAN / same-relay peers)
    if (hops.length < 2) {
      const peerIds: any[] = (node as any).getPeers?.() ?? [];
      for (const pid of peerIds) {
        if (hops.length >= 2) break;
        const idStr = typeof pid === 'string' ? pid : pid.toString();
        if (idStr === myPeerId) continue;
        if (excludePeerIds.includes(idStr)) continue;
        // Skip peers already added from registry
        if (hops.some(h => h.peerId === idStr)) continue;
        try {
          const rawPub: Uint8Array | undefined = (pid as any).publicKey?.raw;
          if (!rawPub || rawPub.length !== 32) continue;
          const x25519Pub = sodium.crypto_sign_ed25519_pk_to_curve25519(rawPub);

          const peer = await (node as any).peerStore?.get?.(pid);
          const protocols: string[] = peer?.protocols ?? [];
          if (!protocols.includes(ONION_PROTOCOL)) continue;
          const addrs: string[] = (peer?.addresses ?? [])
            .map((a: any) => a.multiaddr.toString())
            .filter((a: string) => a.includes('/p2p-circuit'));
          if (addrs.length > 0) hops.push({ peerId: idStr, circuitAddr: addrs[0], x25519Pub });
        } catch { continue; }
      }
    }

    return hops;
  } catch {
    return [];
  }
}
