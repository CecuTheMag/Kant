/**
 * Move an identity to a new device — "user1 hands the account to user1's new
 * phone" — directly between the two devices over libp2p (through the relay
 * circuit like any other Kant traffic; the relay only sees ciphertext).
 *
 *  1. The NEW device starts a temporary node, generates a one-time X25519
 *     key pair and shows a code (QR / link): its public key + circuit address.
 *  2. The OLD device scans it, makes its own one-time key pair and opens one
 *     stream to the new device: `hello` with its public key. Both derive the
 *     same key from the X25519 secret and both show a 6-digit code (SAS).
 *  3. The user checks the codes match and confirms on the NEW device, which
 *     answers `ready` — MACed with the shared key, so the old device knows it
 *     talks to the holder of the scanned key, not just anyone on the relay.
 *  4. The old device streams the sealed bundle (bundle.ts, sessions
 *     included) with windowed acknowledgements; the new device restores it
 *     into its empty database and answers `done` (MACed, with the record
 *     count). Only then does the old device erase itself.
 *
 * The QR code is the trust anchor: it travels optically, so its public key is
 * authentic. Someone who merely saw it could connect first, but would produce
 * a different code on the new device than the old device shows — which is
 * what the comparison in step 3 catches. The new device accepts one session.
 */
import type { Libp2p } from 'libp2p';
import { getSodium } from './sodium.js';
import { getOrDialPeer } from './send-lock.js';
import { frameMessage, readFramedMessage } from './files.js';
import { BundleRestorer, sealedBundle } from './bundle.js';
import type { BundleOptions, BundleSummary } from './bundle.js';

export const TRANSFER_PROTOCOL = '/kant/transfer/1.0.0';
const CODE_PREFIX = 'kant-move:1:';
/** Sealed pieces sent before waiting for an acknowledgement (bounds memory on phones). */
const ACK_WINDOW = 8;

type Sodium = Awaited<ReturnType<typeof getSodium>>;

export interface MoveCode { publicKey: Uint8Array; addr: string }

/* ── Codes ───────────────────────────────────────────────────────────── */

export async function encodeMoveCode(publicKey: Uint8Array, addr: string): Promise<string> {
  const sodium = await getSodium();
  return `${CODE_PREFIX}${sodium.to_base64(publicKey, sodium.base64_variants.URLSAFE_NO_PADDING)}:${addr}`;
}

export async function parseMoveCode(text: string): Promise<MoveCode | null> {
  const sodium = await getSodium();
  const raw = text.trim();
  const at = raw.indexOf(CODE_PREFIX);
  if (at < 0) return null;
  const rest = raw.slice(at + CODE_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  let publicKey: Uint8Array;
  try { publicKey = sodium.from_base64(rest.slice(0, colon), sodium.base64_variants.URLSAFE_NO_PADDING); } catch { return null; }
  const addr = rest.slice(colon + 1);
  if (publicKey.length !== 32 || addr.length > 512) return null;
  if (!/^\/.+\/p2p\/12D3KooW[1-9A-HJ-NP-Za-km-z]{44}\/p2p-circuit\/p2p\/12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/.test(addr)) return null;
  return { publicKey, addr };
}

/* ── Keys ────────────────────────────────────────────────────────────── */

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function deriveSession(sodium: Sodium, ourSecret: Uint8Array, theirPublic: Uint8Array, receiverPublic: Uint8Array, senderPublic: Uint8Array) {
  const shared = sodium.crypto_scalarmult(ourSecret, theirPublic);
  if ((shared as Uint8Array).every((b: number) => b === 0)) throw new Error('BAD_KEY');
  const key = sodium.crypto_generichash(32, cat(sodium.from_string('kant-move-v1'), shared, receiverPublic, senderPublic));
  shared.fill(0);
  const digest = sodium.crypto_generichash(8, cat(sodium.from_string('kant-move-sas'), key));
  const n = new DataView(digest.buffer, digest.byteOffset, 8).getUint32(0, false) % 1_000_000;
  return { key, sas: n.toString().padStart(6, '0') };
}

function mac(sodium: Sodium, key: Uint8Array, label: string): string {
  return sodium.to_base64(sodium.crypto_auth(sodium.from_string(label), key), sodium.base64_variants.ORIGINAL);
}

function macOk(sodium: Sodium, key: Uint8Array, label: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { return sodium.crypto_auth_verify(sodium.from_base64(value, sodium.base64_variants.ORIGINAL), sodium.from_string(label), key); }
  catch { return false; }
}

async function send(stream: any, msg: unknown): Promise<void> {
  await stream.send(frameMessage(msg));
}

/* ── Old device ──────────────────────────────────────────────────────── */

export interface OutgoingMove {
  /** Show this; the new device shows the same code. */
  sas: string;
  /**
   * Wait for the new device's confirmation, then send everything. Resolves
   * with the record count the new device restored; throws DECLINED, BAD_PEER,
   * FAILED or a transport error. Nothing on this device changes either way.
   */
  run: (onProgress?: (sentPieces: number) => void) => Promise<{ records: number }>;
  cancel: () => void;
}

export async function startOutgoingMove(node: Libp2p, code: MoveCode, options: BundleOptions): Promise<OutgoingMove> {
  const sodium = await getSodium();
  const eph = sodium.crypto_box_keypair();
  const { key, sas } = deriveSession(sodium, eph.privateKey, code.publicKey, code.publicKey, eph.publicKey);
  eph.privateKey.fill(0);

  let stream: any;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5 && !stream; attempt++) {
    try {
      const conn = await getOrDialPeer(node, code.addr);
      stream = await (conn as any).newStream(TRANSFER_PROTOCOL, { runOnLimitedConnection: true });
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(r => setTimeout(r, Math.min(4000, 400 * 2 ** attempt)));
    }
  }
  if (!stream) throw lastError ?? new Error('UNREACHABLE');
  await send(stream, { t: 'hello', eph: sodium.to_base64(eph.publicKey, sodium.base64_variants.ORIGINAL) });

  let cancelled = false;
  const cancel = () => { cancelled = true; try { stream.abort?.(new Error('cancelled')); } catch { /* closed */ } };

  const run = async (onProgress?: (sentPieces: number) => void) => {
    try {
      const reply = await readFramedMessage<any>(stream);
      if (reply?.t === 'decline') throw new Error('DECLINED');
      if (reply?.t !== 'ready' || !macOk(sodium, key, 'kant-move-ready', reply.mac)) throw new Error('BAD_PEER');
      let sent = 0;
      let unacked = 0;
      for await (const piece of sealedBundle(key, options)) {
        if (cancelled) throw new Error('CANCELLED');
        await send(stream, { t: 'data', i: sent, d: sodium.to_base64(piece, sodium.base64_variants.ORIGINAL) });
        sent++;
        unacked++;
        onProgress?.(sent);
        if (unacked >= ACK_WINDOW) {
          const ack = await readFramedMessage<any>(stream);
          if (ack?.t === 'failed') throw new Error('FAILED');
          if (ack?.t !== 'ack' || ack.i !== sent - 1) throw new Error('BAD_PEER');
          unacked = 0;
        }
      }
      await send(stream, { t: 'end', n: sent });
      for (;;) {
        const msg = await readFramedMessage<any>(stream);
        if (msg?.t === 'ack') continue;
        if (msg?.t === 'failed') throw new Error('FAILED');
        if (msg?.t !== 'done' || !Number.isSafeInteger(msg.records)
          || !macOk(sodium, key, `kant-move-done:${msg.records}`, msg.mac)) throw new Error('BAD_PEER');
        return { records: msg.records as number };
      }
    } finally {
      key.fill(0);
      try { await stream.close(); } catch { /* already closed */ }
    }
  };
  return { sas, run, cancel };
}

/* ── New device ──────────────────────────────────────────────────────── */

export interface IncomingMoveHandlers {
  /** A device connected: show `sas` and call `decide(true)` once the user saw the same code there. */
  onHello: (sas: string, decide: (accept: boolean) => void) => void;
  onProgress?: (receivedPieces: number) => void;
}

export interface IncomingMove {
  /** Show as a QR code / copyable link on this device. */
  code: string;
  /** Resolves once everything is restored (then unlock with the account password). */
  result: Promise<BundleSummary>;
  stop: () => Promise<void>;
}

/** Wait until the node has a circuit address to put in the code. */
async function circuitAddress(node: Libp2p, timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const addr = node.getMultiaddrs().map(a => a.toString()).find(a => a.includes('/p2p-circuit/p2p/'));
    if (addr) return addr;
    if (Date.now() > end) throw new Error('NO_ADDRESS');
    await new Promise(r => setTimeout(r, 500));
  }
}

export async function startIncomingMove(node: Libp2p, handlers: IncomingMoveHandlers): Promise<IncomingMove> {
  const sodium = await getSodium();
  const kp = sodium.crypto_box_keypair();
  const addr = await circuitAddress(node, 30_000);
  const code = await encodeMoveCode(kp.publicKey, addr);

  let settle!: { resolve: (s: BundleSummary) => void; reject: (e: Error) => void };
  const result = new Promise<BundleSummary>((resolve, reject) => { settle = { resolve, reject }; });
  let busy = false;
  let finished = false;

  await node.handle(TRANSFER_PROTOCOL, async (stream: any) => {
    if (busy || finished) { try { await send(stream, { t: 'decline' }); await stream.close(); } catch { /* ignore */ } return; }
    busy = true;
    let restorer: BundleRestorer | null = null;
    let key: Uint8Array | null = null;
    try {
      const hello = await readFramedMessage<any>(stream);
      if (hello?.t !== 'hello' || typeof hello.eph !== 'string') throw new Error('BAD_PEER');
      const senderPublic = sodium.from_base64(hello.eph, sodium.base64_variants.ORIGINAL);
      if (senderPublic.length !== 32) throw new Error('BAD_PEER');
      const session = deriveSession(sodium, kp.privateKey, senderPublic, kp.publicKey, senderPublic);
      const sessionKey: Uint8Array = session.key;
      key = sessionKey;
      const accepted = await new Promise<boolean>(resolve => handlers.onHello(session.sas, resolve));
      if (!accepted) {
        await send(stream, { t: 'decline' });
        await stream.close();
        busy = false; // let the right device try
        return;
      }
      await send(stream, { t: 'ready', mac: mac(sodium, sessionKey, 'kant-move-ready') });

      restorer = new BundleRestorer(sessionKey);
      await restorer.begin();
      let expected = 0;
      for (;;) {
        const msg = await readFramedMessage<any>(stream);
        if (msg?.t === 'data') {
          if (msg.i !== expected || typeof msg.d !== 'string') throw new Error('BAD_PEER');
          const piece = sodium.from_base64(msg.d, sodium.base64_variants.ORIGINAL);
          if (expected === 0) await restorer.start(piece); else await restorer.push(piece);
          expected++;
          handlers.onProgress?.(expected);
          if (expected % ACK_WINDOW === 0) await send(stream, { t: 'ack', i: expected - 1 });
        } else if (msg?.t === 'end') {
          if (msg.n !== expected) throw new Error('INCOMPLETE');
          const summary = await restorer.finish();
          await send(stream, { t: 'done', records: summary.records, mac: mac(sodium, sessionKey, `kant-move-done:${summary.records}`) });
          finished = true;
          settle.resolve(summary);
          try { await stream.close(); } catch { /* sender closes too */ }
          return;
        } else {
          throw new Error('BAD_PEER');
        }
      }
    } catch (error) {
      await restorer?.abort();
      try { await send(stream, { t: 'failed' }); await stream.close(); } catch { /* gone */ }
      busy = false;
      // A failed attempt is reported but the code stays valid for a retry,
      // unless the data itself was bad after the user confirmed.
      if (restorer) { finished = true; settle.reject(error instanceof Error ? error : new Error(String(error))); }
    } finally {
      key?.fill(0);
    }
  }, { runOnLimitedConnection: true });

  const stop = async () => {
    finished = true;
    kp.privateKey.fill(0);
    try { await node.unhandle(TRANSFER_PROTOCOL); } catch { /* not registered */ }
  };
  return { code, result, stop };
}
