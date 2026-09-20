/**
 * Kant File Sharing — end-to-end encrypted file transfer over P2P.
 *
 * Protocol: /kant/file/1.0.0
 * Encryption: XChaCha20-Poly1305 (ephemeral per-file key, sealed to recipient X25519)
 * Transfer: chunked, length-prefixed frames
 *
 * Wire format:
 *   1. FILE_META   → sender announces file
 *   2. FILE_ACCEPT ← receiver accepts
 *      FILE_REJECT ← receiver rejects
 *   3. FILE_CHUNK × N → sender streams encrypted chunks
 *   4. FILE_ACK    ← receiver confirms integrity
 */

import { getSodium } from './sodium.js';
import type { Libp2p } from 'libp2p';
import { openDB, idbGet as sharedIdbGet, idbPut as sharedIdbPut } from './db.js';
import { getOrDialPeer, withSendLock } from './send-lock.js';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const FILE_PROTOCOL = '/kant/file/1.0.0';
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const DEFAULT_CHUNK_WINDOW = 4;
export const COMMUNITY_MAX_FILE_SIZE  = 100  * 1024 * 1024;
export const ENTERPRISE_MAX_FILE_SIZE = 1024 * 1024 * 1024;

/** Default cap on simultaneously active inbound transfers from one remote peer. */
export const DEFAULT_MAX_CONCURRENT_PER_PEER = 2;
/** Default cap on simultaneously active inbound transfers across all peers. */
export const DEFAULT_MAX_CONCURRENT_TOTAL = 8;

/** Hard cap on a single framed message (16 MiB). */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Transfer timeout: 5 minutes. Prevents hung transfers from blocking forever. */
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileMeta {
  type: 'file-meta';
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  sha256: string;
  /**
   * Ephemeral XChaCha20 key (32 bytes) ‖ base nonce (24 bytes), sealed to the
   * recipient's X25519 public key with crypto_box_seal. Only the recipient's
   * X25519 secret key can open it.
   */
  sealedKey: number[];
  thumbnail?: string;
  display: 'inline' | 'attachment';
  senderPubkeyHex?: string;
  /** Optional v1 extensions. Old receivers ignore this and keep using arrays. */
  capabilities?: {
    base64Chunks?: boolean;
    chunkAcks?: boolean;
  };
}

export interface FileAccept {
  type: 'file-accept';
  fileId: string;
  receivedChunks?: number[];
  chunkEncoding?: 'base64url';
  chunkAcks?: boolean;
}

export interface FileReject {
  type: 'file-reject';
  fileId: string;
  reason: 'too-large' | 'unsupported-type' | 'user-declined' | 'disk-full' | 'busy';
}

export interface FileChunk {
  type: 'file-chunk';
  fileId: string;
  chunkIndex: number;
  data: number[] | string;
}

export interface FileChunkAck {
  type: 'file-chunk-ack';
  fileId: string;
  /** Highest contiguous chunk index persisted by the receiver. */
  receivedThrough: number;
}

export interface FileAck {
  type: 'file-ack';
  fileId: string;
  verified: boolean;
  error?: string;
}

export type FileMessage = FileMeta | FileAccept | FileReject | FileChunk | FileChunkAck | FileAck;

export interface StoredFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  conversationPubkeyHex: string;
  fromMe: boolean;
  timestamp: number;
  blobKey: string;
  thumbnail?: string;
  display: 'inline' | 'attachment';
  status: 'pending' | 'transferring' | 'complete' | 'failed';
  expiresAt?: number;
}

export type FileProgressCallback = (fileId: string, received: number, total: number) => void;

export interface StoredFileBlob {
  fileId: string;
  ciphertext: Uint8Array;
  /** New rows store the nonce separately to avoid a second full-file copy. */
  nonce?: Uint8Array;
  fileName: string;
  mimeType: string;
  fileSize: number;
  timestamp: number;
}

// ── Crypto ────────────────────────────────────────────────────────────────────

export async function generateFileKey(): Promise<{ key: Uint8Array; nonce: Uint8Array }> {
  const sodium = await getSodium();
  const key   = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  return { key, nonce };
}

function chunkNonce(baseNonce: Uint8Array, chunkIndex: number): Uint8Array {
  const nonce = new Uint8Array(baseNonce);
  new DataView(nonce.buffer, nonce.byteOffset, 4).setUint32(0, chunkIndex, false);
  return nonce;
}

function chunkAAD(chunkIndex: number): Uint8Array {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, chunkIndex, false);
  return aad;
}

export async function encryptChunk(
  plainChunk: Uint8Array,
  key: Uint8Array,
  baseNonce: Uint8Array,
  chunkIndex: number
): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plainChunk, chunkAAD(chunkIndex), null, chunkNonce(baseNonce, chunkIndex), key
  );
}

export async function decryptChunk(
  encryptedChunk: Uint8Array,
  key: Uint8Array,
  baseNonce: Uint8Array,
  chunkIndex: number
): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, encryptedChunk, chunkAAD(chunkIndex), chunkNonce(baseNonce, chunkIndex), key
  );
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────
// Uses crypto.subtle when available (browser), falls back to libsodium
// crypto_generichash (BLAKE2b) when crypto.subtle is undefined (Electron
// renderer without contextIsolation, or non-secure contexts).
// NOTE: the fallback produces a BLAKE2b hash, not SHA-256. Both sides must
// use the same implementation. We detect at runtime and embed a flag in the
// hash string so mismatches are caught rather than silently failing.

async function fileHash(data: Uint8Array): Promise<string> {
  // Ensure we hash exactly the right bytes regardless of the underlying buffer
  const bytes = data.buffer.byteLength === data.byteLength && data.byteOffset === 0
    ? data
    : data.slice();

  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
      return Array.from(new Uint8Array(buf)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to libsodium
    }
  }
  // Libsodium BLAKE2b-256 fallback — prefix with 'b2:' so both sides agree
  const sodium = await getSodium();
  const hash = sodium.crypto_generichash(32, bytes);
  return 'b2:' + Array.from(hash as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
}

// ── Frame helpers ─────────────────────────────────────────────────────────────

function frameMessage(msg: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(msg));
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, bytes.length, false);
  const framed = new Uint8Array(4 + bytes.length);
  framed.set(header);
  framed.set(bytes, 4);
  return framed;
}

interface FramedReadWaiter {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface FramedReadState {
  buffer: Uint8Array;
  queued: unknown[];
  waiters: FramedReadWaiter[];
  error?: Error;
}

const streamReadStates = new WeakMap<object, FramedReadState>();

/**
 * Read exactly one length-prefixed message from a stream.
 * Attaches listeners, reads until the full payload arrives, then removes them.
 * Rejects after TRANSFER_TIMEOUT_MS to prevent hung transfers.
 */
function readFramedMessage<T>(stream: any): Promise<T> {
  let state = streamReadStates.get(stream);
  if (!state) {
    state = { buffer: new Uint8Array(), queued: [], waiters: [] };
    streamReadStates.set(stream, state);

    const fail = (error: Error) => {
      if (state!.error) return;
      state!.error = error;
      for (const waiter of state!.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    };
    const pump = () => {
      while (state!.buffer.length >= 4) {
        const length = new DataView(state!.buffer.buffer, state!.buffer.byteOffset, 4).getUint32(0, false);
        if (length > MAX_FRAME_BYTES) { fail(new Error(`Frame too large: ${length} > ${MAX_FRAME_BYTES}`)); return; }
        if (state!.buffer.length < 4 + length) return;
        try {
          const value = JSON.parse(new TextDecoder().decode(state!.buffer.subarray(4, 4 + length)));
          state!.buffer = state!.buffer.slice(4 + length);
          const waiter = state!.waiters.shift();
          if (waiter) { clearTimeout(waiter.timer); waiter.resolve(value); }
          else state!.queued.push(value);
        } catch (error) { fail(new Error(`Failed to parse frame: ${error}`)); return; }
      }
    };
    stream.addEventListener('message', (evt: any) => {
      const data: Uint8Array = evt.data instanceof Uint8Array ? evt.data : evt.data.subarray();
      const combined = new Uint8Array(state!.buffer.length + data.length);
      combined.set(state!.buffer); combined.set(data, state!.buffer.length);
      state!.buffer = combined;
      pump();
    });
    const onClose = (evt?: any) => fail(evt?.error ?? new Error('Stream closed before full frame received'));
    stream.addEventListener('remoteCloseWrite', onClose);
    stream.addEventListener('close', onClose);
  }

  if (state.queued.length > 0) return Promise.resolve(state.queued.shift() as T);
  if (state.error) return Promise.reject(state.error);
  return new Promise<T>((resolve, reject) => {
    const waiter: FramedReadWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = state!.waiters.indexOf(waiter);
        if (index >= 0) state!.waiters.splice(index, 1);
        reject(new Error('Transfer timed out'));
      }, TRANSFER_TIMEOUT_MS),
    };
    state!.waiters.push(waiter);
  });
}

async function sendFramedMessage(stream: any, msg: unknown): Promise<void> {
  await stream.send(frameMessage(msg));
}

function bytesToBase64Url(data: Uint8Array): string {
  let binary = '';
  const block = 0x4000;
  for (let i = 0; i < data.length; i += block) {
    binary += String.fromCharCode(...data.subarray(i, Math.min(i + block, data.length)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// ── Transfer: Sender ──────────────────────────────────────────────────────────

export interface SendFileOptions {
  peerCircuitAddr: string;
  fileData: Uint8Array;
  fileName: string;
  mimeType: string;
  recipientX25519Pub: Uint8Array;
  chunkSize?: number;
  thumbnail?: string;
  maxFileSize?: number;
  senderPubkeyHex?: string;
  onProgress?: FileProgressCallback;
}

export async function sendFile(node: Libp2p, options: SendFileOptions): Promise<string> {
  return withSendLock(node, `file:${options.peerCircuitAddr}`, () => sendFileUnlocked(node, options));
}

async function sendFileUnlocked(node: Libp2p, options: SendFileOptions): Promise<string> {
  const {
    peerCircuitAddr,
    fileData,
    fileName,
    mimeType,
    recipientX25519Pub,
    chunkSize = DEFAULT_CHUNK_SIZE,
    thumbnail,
    maxFileSize = COMMUNITY_MAX_FILE_SIZE,
    onProgress,
  } = options;

  if (fileData.length > maxFileSize) {
    throw new Error(`File too large: ${fileData.length} > ${maxFileSize}`);
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 2 * 1024 * 1024) {
    throw new Error(`Invalid chunk size: ${chunkSize}`);
  }
  const totalChunks = Math.ceil(fileData.length / chunkSize) || 1;
  if (totalChunks > 4096) throw new Error(`Too many chunks: ${totalChunks} > 4096`);
  if (!recipientX25519Pub || recipientX25519Pub.length !== 32) {
    throw new Error('recipientX25519Pub (32 bytes) is required');
  }

  const sodium = await getSodium();
  const fileId = generateId();
  const hash = await fileHash(fileData);
  const { key: encryptKey, nonce: encryptNonce } = await generateFileKey();

  // Seal key ‖ nonce to recipient's X25519 key
  const keyMaterial = new Uint8Array(encryptKey.length + encryptNonce.length);
  keyMaterial.set(encryptKey, 0);
  keyMaterial.set(encryptNonce, encryptKey.length);
  const sealedKey = sodium.crypto_box_seal(keyMaterial, recipientX25519Pub);

  const meta: FileMeta = {
    type: 'file-meta',
    fileId,
    fileName,
    mimeType,
    fileSize: fileData.length,
    chunkSize,
    totalChunks,
    sha256: hash,
    sealedKey: Array.from(sealedKey),
    thumbnail,
    display: mimeType.startsWith('image/') ? 'inline' : 'attachment',
    senderPubkeyHex: options.senderPubkeyHex,
    capabilities: { base64Chunks: true, chunkAcks: true },
  };

  // Open a protocol stream with bounded retry. A live libp2p connection can
  // outlive its relay reservation, so retry stream creation as well as dial.
  let stream: any;
  let lastError: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    let conn: any;
    try {
      conn = await getOrDialPeer(node, peerCircuitAddr);
      stream = await conn.newStream(FILE_PROTOCOL, { runOnLimitedConnection: true });
      break;
    } catch (error: any) {
      lastError = error;
      try { await conn?.close?.(); } catch { /* stale connection cleanup */ }
      if (attempt < 4) {
        const delayMs = Math.min(4_000, 400 * (2 ** attempt)) + Math.floor(Math.random() * 200);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  if (!stream) throw lastError ?? new Error('Failed to open file-transfer stream');

  try {
    // 1. Send FILE_META
    await sendFramedMessage(stream, meta);

    // 2. Wait for accept/reject
    const response = await readFramedMessage<FileAccept | FileReject>(stream);
    if (response.fileId !== fileId) throw new Error('File response id mismatch');
    if (response.type === 'file-reject') {
      throw new Error(`File rejected: ${(response as FileReject).reason}`);
    }
    if (response.type !== 'file-accept') throw new Error(`Unexpected file response: ${(response as any).type}`);

    const useBase64 = response.chunkEncoding === 'base64url';
    const useChunkAcks = response.chunkAcks === true;
    let sentSinceAck = 0;

    // 3. Stream encrypted chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end   = Math.min(start + chunkSize, fileData.length);
      const plain = fileData.slice(start, end);
      const enc   = await encryptChunk(plain, encryptKey, encryptNonce, i);

      await sendFramedMessage(stream, {
        type: 'file-chunk',
        fileId,
        chunkIndex: i,
        data: useBase64 ? bytesToBase64Url(enc) : Array.from(enc),
      } as FileChunk);

      onProgress?.(fileId, i + 1, totalChunks);
      sentSinceAck++;

      // Bound queued ciphertext in Android WebView/libp2p. Drain the receiver's
      // cumulative acknowledgements after each small window.
      if (useChunkAcks && (sentSinceAck >= DEFAULT_CHUNK_WINDOW || i === totalChunks - 1)) {
        let acknowledgedThrough = -1;
        while (acknowledgedThrough < i) {
          const progress = await readFramedMessage<FileChunkAck>(stream);
          if (progress.type !== 'file-chunk-ack' || progress.fileId !== fileId) {
            throw new Error(`Unexpected chunk acknowledgement: ${(progress as any).type}`);
          }
          if (!Number.isSafeInteger(progress.receivedThrough) || progress.receivedThrough < 0 || progress.receivedThrough > i) {
            throw new Error(`Invalid chunk acknowledgement index: ${progress.receivedThrough}`);
          }
          acknowledgedThrough = Math.max(acknowledgedThrough, progress.receivedThrough);
        }
        sentSinceAck = 0;
      }
    }

    // 4. Wait for ACK
    const ack = await readFramedMessage<FileAck>(stream);
    if (ack.type !== 'file-ack' || ack.fileId !== fileId) throw new Error('Invalid final file acknowledgement');
    if (!ack.verified) {
      throw new Error(`File integrity check failed: ${ack.error ?? 'hash mismatch'}`);
    }

    return fileId;
  } finally {
    try { await stream.close(); } catch { /* best-effort */ }
  }
}

// ── Transfer: Receiver ────────────────────────────────────────────────────────

export interface ReceiveFileCallbacks {
  onMeta: (meta: FileMeta) => Promise<'accept' | 'reject' | { reason: string }>;
  onChunk: (fileId: string, chunkIndex: number, plainData: Uint8Array) => Promise<void>;
  onProgress: FileProgressCallback;
  /** Called before the success ACK so receiver persistence failures reach the sender. */
  onComplete: (fileId: string, verified: boolean, data: Uint8Array) => void | Promise<void>;
  onError: (error: Error, fileId?: string) => void;
}

export interface ReceiveFileOptions {
  recipientX25519: { publicKey: Uint8Array; privateKey: Uint8Array };
  maxFileSize?: number;
  /** Max active inbound transfers from a single remote peer (default 2). */
  maxConcurrentPerPeer?: number;
  /** Max active inbound transfers across all peers (default 8). */
  maxConcurrentTotal?: number;
}

function peerKeyForStream(stream: any, connection?: any): string {
  // libp2p supplies the authenticated remote peer on the handler's connection
  // argument. Keep the stream fallback for tests and compatible transports.
  const remotePeer = connection?.remotePeer ?? stream?.remotePeer;
  if (typeof remotePeer === 'string') return remotePeer;
  if (remotePeer?.toString) return remotePeer.toString();
  return 'unknown';
}

export async function registerFileHandler(
  node: Libp2p,
  callbacks: ReceiveFileCallbacks,
  options: ReceiveFileOptions
): Promise<void> {
  const {
    recipientX25519,
    maxFileSize = COMMUNITY_MAX_FILE_SIZE,
    maxConcurrentPerPeer = DEFAULT_MAX_CONCURRENT_PER_PEER,
    maxConcurrentTotal = DEFAULT_MAX_CONCURRENT_TOTAL,
  } = options;

  if (!Number.isSafeInteger(maxConcurrentPerPeer) || maxConcurrentPerPeer < 1) {
    throw new Error(`maxConcurrentPerPeer must be a positive integer, got ${maxConcurrentPerPeer}`);
  }
  if (!Number.isSafeInteger(maxConcurrentTotal) || maxConcurrentTotal < 1) {
    throw new Error(`maxConcurrentTotal must be a positive integer, got ${maxConcurrentTotal}`);
  }

  // Active-transfer accounting. A slot is held from the moment a transfer is
  // accepted until that transfer exits (success, error, or busy reject), and
  // is always released in the handler's `finally`. Per-peer accounting stops
  // one remote peer from monopolising the receiver; the total caps aggregate
  // load from many peers at once.
  const perPeerCounts = new Map<string, number>();
  let totalActive = 0;

  const isAtCapacity = (peerKey: string): boolean =>
    totalActive >= maxConcurrentTotal || (perPeerCounts.get(peerKey) ?? 0) >= maxConcurrentPerPeer;

  const tryAcquire = (peerKey: string): boolean => {
    if (isAtCapacity(peerKey)) return false;
    perPeerCounts.set(peerKey, (perPeerCounts.get(peerKey) ?? 0) + 1);
    totalActive++;
    return true;
  };

  const release = (peerKey: string): void => {
    const count = perPeerCounts.get(peerKey) ?? 0;
    if (count > 1) perPeerCounts.set(peerKey, count - 1);
    else perPeerCounts.delete(peerKey);
    if (totalActive > 0) totalActive--;
  };

  const sendReject = async (stream: any, fileId: string, reason: FileReject['reason']): Promise<void> => {
    await sendFramedMessage(stream, { type: 'file-reject', fileId, reason } as FileReject);
    await stream.close();
  };

  await node.handle(FILE_PROTOCOL, async (stream: any, connection: any) => {
    const peerKey = peerKeyForStream(stream, connection);
    let acquired = false;
    let activeFileId: string | undefined;
    try {
      const sodium = await getSodium();

      // 1. Read FILE_META
      const meta = await readFramedMessage<FileMeta>(stream);
      if (meta.type !== 'file-meta') throw new Error('Expected FILE_META');
      activeFileId = meta.fileId;

      // Validate size before allocating
      if (!Number.isSafeInteger(meta.fileSize) || meta.fileSize < 0 || meta.fileSize > maxFileSize) {
        await sendReject(stream, meta.fileId, 'too-large');
        return;
      }

      // Validate chunk geometry before division/allocation. JSON-encoding a
      // Uint8Array expands it substantially, so keep each wire frame bounded.
      if (!Number.isSafeInteger(meta.chunkSize) || meta.chunkSize <= 0 || meta.chunkSize > 2 * 1024 * 1024) {
        await sendReject(stream, meta.fileId, 'too-large');
        return;
      }
      const expectedChunks = Math.ceil(meta.fileSize / meta.chunkSize) || 1;
      if (meta.totalChunks !== expectedChunks || meta.totalChunks > 4096) {
        await sendReject(stream, meta.fileId, 'too-large');
        return;
      }

      // 2. Capacity gate: fast-fail with a busy reject before prompting the
      // app, so an overloaded receiver does not accumulate pending accepts.
      if (isAtCapacity(peerKey)) {
        await sendReject(stream, meta.fileId, 'busy');
        return;
      }

      const decision = await callbacks.onMeta(meta);
      if (typeof decision === 'string' && decision === 'accept') {
        // Authoritative capacity check at accept time — the pre-check state can
        // change while the app decides. A busy reject is a normal protocol
        // outcome, not an error.
        if (!tryAcquire(peerKey)) {
          await sendReject(stream, meta.fileId, 'busy');
          return;
        }
        acquired = true;
        await sendFramedMessage(stream, {
          type: 'file-accept',
          fileId: meta.fileId,
          chunkEncoding: meta.capabilities?.base64Chunks ? 'base64url' : undefined,
          chunkAcks: meta.capabilities?.chunkAcks === true,
        } as FileAccept);
      } else {
        const reason = typeof decision === 'object' ? decision.reason : 'user-declined';
        await sendReject(stream, meta.fileId, reason as FileReject['reason']);
        return;
      }

      // 3. Open sealed key
      const sealedKeyBytes = new Uint8Array(meta.sealedKey);
      let keyMaterial: Uint8Array;
      try {
        keyMaterial = sodium.crypto_box_seal_open(
          sealedKeyBytes,
          recipientX25519.publicKey,
          recipientX25519.privateKey
        );
      } catch {
        throw new Error('Failed to open sealed file key — not addressed to us or corrupted');
      }
      if (!keyMaterial || keyMaterial.length !== 32 + 24) {
        throw new Error('Sealed key has wrong length');
      }
      const encryptKey   = keyMaterial.subarray(0, 32);
      const encryptNonce = keyMaterial.subarray(32, 56);

      // 4. Receive chunks
      const receivedData = new Uint8Array(meta.fileSize);
      const receivedIndices = new Set<number>();
      let receivedCount = 0;

      while (receivedCount < meta.totalChunks) {
        const msg = await readFramedMessage<FileMessage>(stream);
        if (msg.type !== 'file-chunk') continue;

        const chunk = msg as FileChunk;
        if (chunk.fileId !== meta.fileId) continue;
        if (!Number.isSafeInteger(chunk.chunkIndex) || chunk.chunkIndex < 0 || chunk.chunkIndex >= meta.totalChunks) continue;
        if (receivedIndices.has(chunk.chunkIndex)) continue;

        let encryptedData: Uint8Array;
        if (typeof chunk.data === 'string') {
          if (!meta.capabilities?.base64Chunks) throw new Error('Unexpected base64 file chunk');
          try { encryptedData = base64UrlToBytes(chunk.data); }
          catch { throw new Error(`Chunk ${chunk.chunkIndex} has invalid base64 data`); }
        } else if (Array.isArray(chunk.data)) {
          if (chunk.data.some(value => !Number.isSafeInteger(value) || value < 0 || value > 255)) {
            throw new Error(`Chunk ${chunk.chunkIndex} has invalid byte data`);
          }
          encryptedData = new Uint8Array(chunk.data);
        } else {
          throw new Error(`Chunk ${chunk.chunkIndex} has invalid encoding`);
        }

        const offset = chunk.chunkIndex * meta.chunkSize;
        const expectedPlainLength = Math.min(meta.chunkSize, meta.fileSize - offset);
        // XChaCha20-Poly1305 appends a fixed 16-byte authentication tag.
        if (encryptedData.length !== expectedPlainLength + 16) {
          throw new Error(`Chunk ${chunk.chunkIndex} has invalid encrypted length`);
        }
        const plain = await decryptChunk(
          encryptedData, encryptKey, encryptNonce, chunk.chunkIndex
        );

        if (plain.length !== expectedPlainLength) {
          throw new Error(`Chunk ${chunk.chunkIndex} has invalid length ${plain.length}, expected ${expectedPlainLength}`);
        }
        if (offset + plain.length > receivedData.length) {
          throw new Error(`Chunk ${chunk.chunkIndex} overflows file buffer`);
        }
        receivedData.set(plain, offset);
        receivedIndices.add(chunk.chunkIndex);
        receivedCount++;

        callbacks.onProgress(meta.fileId, receivedCount, meta.totalChunks);
        await callbacks.onChunk(meta.fileId, chunk.chunkIndex, plain);
        if (meta.capabilities?.chunkAcks) {
          await sendFramedMessage(stream, {
            type: 'file-chunk-ack',
            fileId: meta.fileId,
            receivedThrough: chunk.chunkIndex,
          } as FileChunkAck);
        }
      }

      // 5. Verify hash
      const actualHash = await fileHash(receivedData);
      const verified   = actualHash === meta.sha256;

      if (!verified) {
        await callbacks.onComplete(meta.fileId, false, receivedData);
        await sendFramedMessage(stream, {
          type: 'file-ack', fileId: meta.fileId, verified: false, error: 'hash mismatch',
        } as FileAck);
        return;
      }

      try {
        // Persistence is part of delivery. Do not tell the sender the transfer
        // succeeded until the receiver can actually open/download the file.
        await callbacks.onComplete(meta.fileId, true, receivedData);
        await sendFramedMessage(stream, {
          type: 'file-ack', fileId: meta.fileId, verified: true,
        } as FileAck);
      } catch (error) {
        await sendFramedMessage(stream, {
          type: 'file-ack', fileId: meta.fileId, verified: false, error: 'receiver storage failed',
        } as FileAck).catch(() => {});
        throw error;
      }
    } catch (e) {
      callbacks.onError(e as Error, activeFileId);
    } finally {
      // Always release the slot so a subsequent transfer can proceed, whether
      // this one completed, errored, or was rejected mid-flight.
      if (acquired) release(peerKey);
      try { await stream.close(); } catch { /* best-effort */ }
    }
  }, { runOnLimitedConnection: true });
}

// ── Blob persistence (encrypted at rest in IDB) ───────────────────────────────

const FILE_STORE = 'files';

function deriveFileAtRestKey(sodium: any, derivedKey: Uint8Array): Uint8Array {
  return sodium.crypto_kdf_derive_from_key(32, 1, 'kantfile', derivedKey);
}

export async function saveFileBlob(
  fileId: string,
  data: Uint8Array,
  meta: { fileName: string; mimeType: string; fileSize: number },
  derivedKey: Uint8Array
): Promise<void> {
  const sodium = await getSodium();
  const key    = deriveFileAtRestKey(sodium, derivedKey);
  const nonce  = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct     = sodium.crypto_secretbox_easy(data, nonce, key);

  const blob: StoredFileBlob = {
    fileId, ciphertext: ct, nonce,
    fileName: meta.fileName, mimeType: meta.mimeType, fileSize: meta.fileSize,
    timestamp: Date.now(),
  };

  const db = await openDB();
  await sharedIdbPut(db, FILE_STORE, blob);
  db.close();
}

export async function getFileBlob(
  fileId: string,
  derivedKey: Uint8Array
): Promise<{ data: Uint8Array; fileName: string; mimeType: string; fileSize: number } | null> {
  const db   = await openDB();
  const blob = await sharedIdbGet<StoredFileBlob>(db, FILE_STORE, fileId);
  db.close();
  if (!blob) return null;

  const sodium = await getSodium();
  const key = deriveFileAtRestKey(sodium, derivedKey);
  const ct  = blob.ciphertext instanceof Uint8Array ? blob.ciphertext : new Uint8Array(Object.values(blob.ciphertext as any));
  const storedNonce = blob.nonce instanceof Uint8Array
    ? blob.nonce
    : blob.nonce ? new Uint8Array(Object.values(blob.nonce as any)) : undefined;
  // Legacy rows contain nonce || ciphertext in the ciphertext field.
  const nonce = storedNonce ?? ct.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const body  = storedNonce ? ct : ct.slice(sodium.crypto_secretbox_NONCEBYTES);
  const data  = sodium.crypto_secretbox_open_easy(body, nonce, key);
  return { data, fileName: blob.fileName, mimeType: blob.mimeType, fileSize: blob.fileSize };
}
