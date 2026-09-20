/**
 * Kant Groups — Sender Keys group chat (Phase 2a)
 *
 * Crypto model:
 *   - Each group has a shared symmetric key (32 bytes) — the "group key"
 *   - The group creator generates the key and distributes it to each member
 *     individually, encrypted with that member's X3DH public bundle
 *   - Messages are encrypted with XChaCha20-Poly1305 using the group key
 *   - On member removal, the creator rotates the group key and re-distributes
 *     to remaining members
 *
 * Wire protocol: /kant/group/1.0.0
 *   All group control messages (invite, key-rotation) are JSON over this protocol.
 *   Group chat messages are sent over the existing PING protocol with type='group-msg'.
 *
 * IDB: 'groups' store (keyPath: 'id'), DB_VERSION bumped to 4
 */

import { getSodium } from './sodium.js';
import type { UnlockedIdentity } from './identity.js';
import { openDB as sharedOpenDB, idbGet as sharedIdbGet, idbPut as sharedIdbPut, idbGetAll as sharedIdbGetAll, idbDelete as sharedIdbDelete } from './db.js';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
}
import type { Libp2p } from 'libp2p';
import { ed25519ToX25519, x3dhSend, x3dhReceive } from './ratchet.js';
import { withSendLock, getOrDialPeer } from './send-lock.js';
import { burnOPK, getOPK } from './prekey.js';
import type { X3DHPublicBundle } from './ratchet.js';
import { buildPrivateBundle } from './prekey.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const GROUP_PROTOCOL = '/kant/group/1.0.0';

/** Hard cap on a single length-prefixed frame (16 MiB) to bound memory. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const GROUP_ACK_TIMEOUT_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliveryTask {
  id?: number;
  groupId: string;
  keyGeneration: number;
  memberPublicKey: string;
  payload: WrappedGroupKey;
  attempts: number;
  lastAttempt: number;
  nextAttempt: number;
  status: 'pending' | 'failed';
  /** Only explicit receiver rejection permits replacing the exact envelope. */
  failureReason?: 'opk_unavailable';
}

interface WrappedGroupKey {
  deliveryId: string;
  ephemeralPublic: Uint8Array;
  encryptedGroupKey: Uint8Array;
  nonce: Uint8Array;
  opkId?: string;
}

export interface GroupMember {
  publicKeyHex: string;
  nickname?: string;
  circuitAddr: string;   // last known circuit address
  joinedAt: number;
}

export interface Group {
  id: string;            // random UUID
  name: string;
  createdBy: string;     // publicKeyHex of creator
  createdAt: number;
  members: GroupMember[];
  /** Symmetric group key (32 bytes) — stored encrypted at rest */
  encryptedKey: Uint8Array;
  /** Nonce used to encrypt the group key */
  keyNonce: Uint8Array;
  /** Generation counter — incremented on every key rotation */
  keyGeneration: number;
  /** Last successfully processed group-key envelope (idempotent retry guard). */
  lastKeyDeliveryId?: string;
}

interface GroupKeyAck {
  type: 'group-key-ack';
  deliveryId: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  reason?: 'opk_unavailable' | 'unwrap_failed' | 'invalid_payload';
}

export class GroupKeyDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code: GroupKeyAck['reason'] | 'invalid_ack'
  ) {
    super(message);
    this.name = 'GroupKeyDeliveryError';
  }
}

export interface GroupMessage {
  id: string;
  groupId: string;
  fromPubKeyHex: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  timestamp: number;
  keyGeneration: number;
  /** Unix ms when this message should be deleted. 0 = never. */
  expiresAt: number;
}

export interface StoredGroupConversation {
  groupId: string;       // also the IDB key (publicKeyHex field for keyPath compat)
  publicKeyHex: string;  // = groupId (satisfies keyPath)
  messages: GroupMessage[];
}

// ── IDB (delegates to shared db.ts) ──────────────────────────────────────────

const openDB     = sharedOpenDB;
const idbGet     = sharedIdbGet;
const idbPut     = sharedIdbPut;
const idbGetAll  = sharedIdbGetAll;
const idbDelete  = sharedIdbDelete;

// ── Key encryption at rest ────────────────────────────────────────────────────

/** Encrypt a group key using the Argon2id-derived key for at-rest storage.
 *  The derivedKey comes from unlockIdentity() and is password-gated. */
async function encryptGroupKey(groupKey: Uint8Array, derivedKey: Uint8Array): Promise<{ encryptedKey: Uint8Array; keyNonce: Uint8Array }> {
  const sodium = await getSodium();
  const encKey = sodium.crypto_kdf_derive_from_key(32, 2, 'kantgrpk', derivedKey);
  const nonce  = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const encryptedKey = sodium.crypto_secretbox_easy(groupKey, nonce, encKey);
  return { encryptedKey, keyNonce: nonce };
}

/** Decrypt a group key from at-rest storage */
async function decryptGroupKey(encryptedKey: Uint8Array, keyNonce: Uint8Array, derivedKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  const encKey = sodium.crypto_kdf_derive_from_key(32, 2, 'kantgrpk', derivedKey);
  return sodium.crypto_secretbox_open_easy(encryptedKey, keyNonce, encKey);
}

// ── Group key distribution (X3DH-wrapped) ────────────────────────────────────

function frameGroupPayload(value: unknown): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  if (payload.byteLength > MAX_FRAME_BYTES) throw new Error(`Frame too large: ${payload.byteLength} > ${MAX_FRAME_BYTES}`);
  const framed = new Uint8Array(4 + payload.byteLength);
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false);
  framed.set(payload, 4);
  return framed;
}

function readGroupPayload<T>(stream: any, timeoutMs = GROUP_ACK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let buffer = new Uint8Array(0);
    let expectedLength: number | null = null;
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value as T);
    };
    const pump = () => {
      if (expectedLength === null && buffer.byteLength >= 4) {
        expectedLength = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, false);
        if (expectedLength > MAX_FRAME_BYTES) {
          finish(new Error(`Frame too large: ${expectedLength} > ${MAX_FRAME_BYTES}`));
          return;
        }
      }
      if (expectedLength !== null && buffer.byteLength >= 4 + expectedLength) {
        try {
          const raw = buffer.subarray(4, 4 + expectedLength);
          finish(undefined, JSON.parse(new TextDecoder().decode(raw)) as T);
        } catch (error) {
          finish(new Error(`Invalid group frame: ${String(error)}`));
        }
      }
    };
    const timer = setTimeout(() => finish(new Error(`Group protocol response timed out after ${timeoutMs}ms`)), timeoutMs);
    stream.addEventListener('message', (event: any) => {
      const data: Uint8Array = event.data instanceof Uint8Array ? event.data : event.data.subarray();
      const combined = new Uint8Array(buffer.byteLength + data.byteLength);
      combined.set(buffer);
      combined.set(data, buffer.byteLength);
      buffer = combined;
      pump();
    });
    const onClose = (event?: any) => finish(event?.error ?? new Error('Group stream closed before response'));
    stream.addEventListener('remoteCloseWrite', onClose);
    stream.addEventListener('close', onClose);
  });
}

/**
 * Wrap a group key for delivery to a specific member using their X3DH public bundle.
 * Returns a JSON-serialisable envelope.
 */
async function wrapGroupKeyForMember(
  groupKey: Uint8Array,
  myX25519: { publicKey: Uint8Array; privateKey: Uint8Array },
  memberBundle: X3DHPublicBundle
): Promise<WrappedGroupKey> {
  const sodium = await getSodium();
  const { sharedSecret, ephemeralPublic, opkId } = await x3dhSend(myX25519, memberBundle as any);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const encryptedGroupKey = sodium.crypto_secretbox_easy(groupKey, nonce, sharedSecret);
  return { deliveryId: generateId(), ephemeralPublic, encryptedGroupKey, nonce, opkId };
}

/**
 * Unwrap a group key received from another member.
 */
async function unwrapGroupKey(
  encryptedGroupKey: Uint8Array,
  nonce: Uint8Array,
  myPrivateBundle: { identityKeypair: { publicKey: Uint8Array; privateKey: Uint8Array }; signedPreKeypair: { publicKey: Uint8Array; privateKey: Uint8Array } },
  senderIdentityPub: Uint8Array,
  ephemeralPub: Uint8Array,
  opkPrivateKey?: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();
  const sharedSecret = await x3dhReceive(myPrivateBundle, senderIdentityPub, ephemeralPub, opkPrivateKey);
  return sodium.crypto_secretbox_open_easy(encryptedGroupKey, nonce, sharedSecret);
}

// ── Group CRUD ────────────────────────────────────────────────────────────────

/** Create a new group. Does NOT distribute keys — call distributeGroupKey() after. */
export async function createGroup(
  name: string,
  members: GroupMember[],
  identity: UnlockedIdentity
): Promise<Group> {
  const sodium   = await getSodium();
  const groupKey = sodium.randombytes_buf(32);
  const { encryptedKey, keyNonce } = await encryptGroupKey(groupKey, identity.derivedKey);

  const group: Group = {
    id:           generateId(),
    name,
    createdBy:    identity.publicKeyHex,
    createdAt:    Date.now(),
    members,
    encryptedKey,
    keyNonce,
    keyGeneration: 0,
  };

  const db = await openDB();
  await idbPut(db, 'groups', group);
  db.close();
  return group;
}

/** Get all groups */
export async function getGroups(): Promise<Group[]> {
  const db     = await openDB();
  const groups = await idbGetAll<Group>(db, 'groups');
  db.close();
  return groups;
}

/** Get a single group by id */
export async function getGroup(id: string): Promise<Group | undefined> {
  const db    = await openDB();
  const group = await idbGet<Group>(db, 'groups', id);
  db.close();
  return group;
}

/** Save (create or update) a group */
export async function saveGroup(group: Group): Promise<void> {
  const db = await openDB();
  await idbPut(db, 'groups', group);
  db.close();
}

/** Delete a group and its messages */
export async function deleteGroup(id: string): Promise<void> {
  const db = await openDB();
  await idbDelete(db, 'groups', id);
  await idbDelete(db, 'groupmsgs', id);
  db.close();
}

// ── Group key distribution ────────────────────────────────────────────────────

/**
 * Send the group key to a single member over the GROUP_PROTOCOL.
 * The key is wrapped with X3DH so only the recipient can unwrap it.
 */
async function sendWrappedGroupKeyToMember(
  node: Libp2p,
  group: Group,
  member: GroupMember,
  senderIdentityPub: Uint8Array,
  wrapped: WrappedGroupKey
): Promise<void> {
  // Include our current circuit addresses so the recipient can reach us immediately.
  const myCircuitAddrs = node.getMultiaddrs()
    .map((a: any) => a.toString())
    .filter((a: string) => a.includes('/p2p-circuit'));

  const payload = {
    type:               'group-key',
    deliveryId:         wrapped.deliveryId,
    groupId:            group.id,
    groupName:          group.name,
    keyGeneration:      group.keyGeneration,
    createdBy:          group.createdBy,
    createdAt:          group.createdAt,
    members:            group.members.map(m => ({
      publicKeyHex: m.publicKeyHex,
      nickname:     m.nickname,
      circuitAddr:  m.circuitAddr,
      joinedAt:     m.joinedAt,
    })),
    senderIdentityPub:  Array.from(senderIdentityPub),
    ephemeralPublic:    Array.from(wrapped.ephemeralPublic),
    encryptedGroupKey:  Array.from(wrapped.encryptedGroupKey),
    keyNonce:           Array.from(wrapped.nonce),
    opkId:              wrapped.opkId,
    senderCircuitAddrs: myCircuitAddrs,
  };

  // Reuse the circuit opened for the pre-key fetch whenever possible. Opening
  // a second relay circuit back-to-back is rejected intermittently by
  // circuit-relay-v2 (CONNECTION_FAILED / NoValidAddressesError).
  const conn = await getOrDialPeer(node, member.circuitAddr);
  const stream: any = await conn.newStream(GROUP_PROTOCOL, { runOnLimitedConnection: true });
  try {
    const ackPromise = readGroupPayload<GroupKeyAck>(stream);
    await stream.send(frameGroupPayload(payload));
    const ack = await ackPromise;
    if (ack?.type !== 'group-key-ack' || ack.deliveryId !== wrapped.deliveryId) {
      throw new GroupKeyDeliveryError('invalid or mismatched group-key acknowledgement', 'invalid_ack');
    }
    if (ack.status === 'rejected') {
      throw new GroupKeyDeliveryError(
        `group-key rejected: ${ack.reason ?? 'invalid_payload'}`,
        ack.reason ?? 'invalid_payload'
      );
    }
  } finally {
    try { await stream.close(); } catch { /* best effort */ }
  }
}

export async function sendGroupKeyToMember(
  node: Libp2p,
  group: Group,
  member: GroupMember,
  identity: UnlockedIdentity,
  memberBundle: X3DHPublicBundle
): Promise<void> {
  const myX25519 = await ed25519ToX25519(identity.publicKey, identity.privateKey);
  const groupKey = await decryptGroupKey(group.encryptedKey, group.keyNonce, identity.derivedKey);
  const wrapped = await wrapGroupKeyForMember(groupKey, myX25519, memberBundle);
  await sendWrappedGroupKeyToMember(node, group, member, myX25519.publicKey, wrapped);
}

/**
 * Distribute the group key to all members (except self).
 * A failed network send persists the exact wrapped envelope. Retrying the same
 * generation must not consume/re-wrap another OPK.
 */
export async function distributeGroupKey(
  node: Libp2p,
  group: Group,
  identity: UnlockedIdentity,
  memberBundles: Map<string, X3DHPublicBundle>
): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = [];
  const failed: string[] = [];
  const myX25519 = await ed25519ToX25519(identity.publicKey, identity.privateKey);
  const groupKey = await decryptGroupKey(group.encryptedKey, group.keyNonce, identity.derivedKey);

  for (const member of group.members) {
    if (member.publicKeyHex === identity.publicKeyHex) continue;
    const bundle = memberBundles.get(member.publicKeyHex);
    if (!bundle) {
      failed.push(member.publicKeyHex);
      continue;
    }

    let wrapped: WrappedGroupKey;
    try {
      wrapped = await wrapGroupKeyForMember(groupKey, myX25519, bundle);
    } catch (error) {
      console.warn('[groups] failed to wrap key for', member.publicKeyHex.slice(0, 12), error);
      failed.push(member.publicKeyHex);
      continue;
    }

    try {
      await withSendLock(node, member.publicKeyHex, () =>
        sendWrappedGroupKeyToMember(node, group, member, myX25519.publicKey, wrapped)
      );
      sent.push(member.publicKeyHex);
    } catch (error) {
      console.warn('[groups] failed to send key to', member.publicKeyHex.slice(0, 12), 'queueing exact envelope', error);
      const now = Date.now();
      try {
        const db = await openDB();
        const tasks = await idbGetAll<DeliveryTask>(db, 'delivery_queue');
        const existing = tasks.find(task =>
          task.groupId === group.id && task.memberPublicKey === member.publicKeyHex
        );
        const task: DeliveryTask = {
          ...(existing?.id === undefined ? {} : { id: existing.id }),
          groupId: group.id,
          keyGeneration: group.keyGeneration,
          memberPublicKey: member.publicKeyHex,
          payload: wrapped,
          attempts: 0,
          lastAttempt: now,
          nextAttempt: now,
          status: 'pending',
        };
        await idbPut(db, 'delivery_queue', task);
        db.close();
      } catch (queueError) {
        console.error('[groups] critical failure queueing delivery task', queueError);
      }
      failed.push(member.publicKeyHex);
    }
  }

  return { sent, failed };
}

// ── Delivery Queue Processing ──────────────────────────────────────────────────

const MAX_RETRIES = 10;

/**
 * Process the delivery queue: attempt redelivery of pending group keys.
 */
export async function processDeliveryQueue(
  node: Libp2p,
  identity: UnlockedIdentity,
  memberBundles: Map<string, X3DHPublicBundle>
): Promise<{ sent: string[]; failed: string[]; opkUnavailable: string[] }> {
  const db = await openDB();
  const tasks = await idbGetAll<DeliveryTask>(db, 'delivery_queue');
  const now = Date.now();
  const myX25519 = await ed25519ToX25519(identity.publicKey, identity.privateKey);
  const result = { sent: [] as string[], failed: [] as string[], opkUnavailable: [] as string[] };

  for (const task of tasks) {
    const hasExplicitReplacement = task.failureReason === 'opk_unavailable' && memberBundles.has(task.memberPublicKey);
    if ((task.status === 'failed' || task.nextAttempt > now) && !hasExplicitReplacement) continue;
    if (task.id === undefined) {
      console.error('[groups] refusing delivery task without an IndexedDB key', task.groupId, task.memberPublicKey);
      continue;
    }

    try {
      await withSendLock(node, task.memberPublicKey, async () => {
        const group = await idbGet<Group>(db, 'groups', task.groupId);
        if (!group) throw new Error('group not found');
        const member = group.members.find(m => m.publicKeyHex === task.memberPublicKey);
        if (!member) throw new Error('member not in group');

        // Preserve the exact X3DH/OPK envelope for a generation. If the group
        // rotated while this task waited, create and persist one fresh envelope
        // for the new generation before attempting network I/O.
        if (task.keyGeneration !== group.keyGeneration || hasExplicitReplacement) {
          const bundle = memberBundles.get(task.memberPublicKey);
          if (!bundle) throw new Error('fresh member bundle required after key rotation or OPK rejection');
          const groupKey = await decryptGroupKey(group.encryptedKey, group.keyNonce, identity.derivedKey);
          task.payload = await wrapGroupKeyForMember(groupKey, myX25519, bundle);
          task.keyGeneration = group.keyGeneration;
          task.attempts = 0;
          delete task.failureReason;
          task.status = 'pending';
          task.nextAttempt = now;
          await idbPut(db, 'delivery_queue', task);
        }

        await sendWrappedGroupKeyToMember(
          node,
          group,
          member,
          myX25519.publicKey,
          task.payload
        );
      });

      await idbDelete(db, 'delivery_queue', task.id);
      result.sent.push(task.memberPublicKey);
      console.log(`[groups] successfully delivered queued key to ${task.memberPublicKey.slice(0, 12)}`);
    } catch (error) {
      const opkUnavailable = error instanceof GroupKeyDeliveryError && error.code === 'opk_unavailable';
      const attempts = (task.attempts || 0) + 1;
      const backoffMs = Math.min(Math.pow(2, attempts) * 30_000, 60 * 60 * 1000);
      // An explicit OPK rejection is recoverable by fetching a fresh bundle,
      // even if ambiguous network retries had already reached their cap.
      const status = opkUnavailable ? 'pending' : attempts >= MAX_RETRIES ? 'failed' : 'pending';

      console.warn(`[groups] retry ${attempts}/${MAX_RETRIES} failed for ${task.memberPublicKey.slice(0, 12)}:`, error);

      await idbPut(db, 'delivery_queue', {
        ...task,
        attempts,
        lastAttempt: now,
        nextAttempt: opkUnavailable ? now : now + backoffMs,
        status,
        ...(opkUnavailable ? { failureReason: 'opk_unavailable' as const } : {}),
      });
      result.failed.push(task.memberPublicKey);
      if (opkUnavailable) result.opkUnavailable.push(task.memberPublicKey);
    }
  }
  db.close();
  return result;
}

/**
 * Get current status of the delivery queue for debug UI.
 */
export async function getDeliveryQueueStatus(): Promise<{ pending: number; failed: number }> {
  const db = await openDB();
  const tasks = await idbGetAll<DeliveryTask>(db, 'delivery_queue');
  db.close();

  return {
    pending: tasks.filter(t => t.status === 'pending').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };
}

// ── Group key rotation ────────────────────────────────────────────────────────

/**
 * Rotate the group key (e.g. after removing a member).
 * Generates a new key, saves it, and re-distributes to remaining members.
 */
export async function rotateGroupKey(
  node: Libp2p,
  group: Group,
  identity: UnlockedIdentity,
  memberBundles: Map<string, X3DHPublicBundle>
): Promise<Group> {
  const sodium   = await getSodium();
  const newKey   = sodium.randombytes_buf(32);
  const { encryptedKey, keyNonce } = await encryptGroupKey(newKey, identity.derivedKey);

  const updated: Group = {
    ...group,
    encryptedKey,
    keyNonce,
    keyGeneration: group.keyGeneration + 1,
  };

  await saveGroup(updated);
  await distributeGroupKey(node, updated, identity, memberBundles);
  return updated;
}

// ── Group message encryption ──────────────────────────────────────────────────

/** Encrypt a plaintext message with the group key */
export async function encryptGroupMessage(
  plaintext: string,
  group: Group,
  identity: UnlockedIdentity
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const sodium   = await getSodium();
  const groupKey = await decryptGroupKey(group.encryptedKey, group.keyNonce, identity.derivedKey);
  const nonce    = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    new TextEncoder().encode(plaintext), null, null, nonce, groupKey
  );
  return { ciphertext, nonce };
}

/** Decrypt a group message */
export async function decryptGroupMessage(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  group: Group,
  identity: UnlockedIdentity
): Promise<string> {
  const sodium   = await getSodium();
  const groupKey = await decryptGroupKey(group.encryptedKey, group.keyNonce, identity.derivedKey);
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, ciphertext, null, nonce, groupKey
  );
  return new TextDecoder().decode(plaintext);
}

// ── Group message persistence ─────────────────────────────────────────────────

/** Save a group message to IDB */
export async function saveGroupMessage(msg: GroupMessage): Promise<void> {
  const db   = await openDB();
  const conv = await idbGet<StoredGroupConversation>(db, 'groupmsgs', msg.groupId)
    ?? { groupId: msg.groupId, publicKeyHex: msg.groupId, messages: [] };
  conv.messages.push(msg);
  await idbPut(db, 'groupmsgs', conv);
  db.close();
}

/** Load all messages for a group, purging any that have expired */
export async function getGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const db   = await openDB();
  const conv = await idbGet<StoredGroupConversation>(db, 'groupmsgs', groupId);
  if (!conv) { db.close(); return []; }
  const now    = Date.now();
  const active = conv.messages.filter(m => !m.expiresAt || m.expiresAt > now);
  if (active.length !== conv.messages.length) {
    await idbPut(db, 'groupmsgs', { ...conv, messages: active });
  }
  db.close();
  return active;
}

// ── Incoming group-key handler ────────────────────────────────────────────────

/**
 * Process an incoming 'group-key' message from another peer.
 * Unwraps the group key and saves the group to IDB.
 *
 * Security: verifies that the sender is the group creator for initial
 * distribution and rotations. Rejects all other senders to prevent a listed
 * or compromised member from replacing the group's shared key.
 */
export async function handleIncomingGroupKey(
  payload: any,
  identity: UnlockedIdentity,
  privateBundle: { identityKeypair: { publicKey: Uint8Array; privateKey: Uint8Array }; signedPreKeypair: { publicKey: Uint8Array; privateKey: Uint8Array } },
  opkPrivateKey?: Uint8Array
): Promise<Group> {
  const sodium = await getSodium();

  const senderIdentityPub = new Uint8Array(Object.values(payload.senderIdentityPub) as number[]);
  const ephemeralPub      = new Uint8Array(Object.values(payload.ephemeralPublic) as number[]);
  const encryptedGroupKey = new Uint8Array(Object.values(payload.encryptedGroupKey) as number[]);
  const keyNonce          = new Uint8Array(Object.values(payload.keyNonce) as number[]);

  // Derive the sender's Ed25519 public key hex from their X25519 identity pub.
  // The payload includes createdBy (Ed25519 hex). Verify the sender's X25519
  // public key matches it by converting that Ed25519 key to X25519.
  // Only the creator may establish or rotate the shared key. Allowing any
  // listed member here lets a compromised member replace the group key.
  const senderHexCandidates: string[] = [payload.createdBy as string].filter(Boolean);

  let senderVerified = false;
  for (const hex of senderHexCandidates) {
    try {
      const ed25519Pub = sodium.from_hex(hex);
      const x25519Pub  = sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519Pub);
      if (x25519Pub.length === senderIdentityPub.length &&
          x25519Pub.every((b: number, i: number) => b === senderIdentityPub[i])) {
        senderVerified = true;
        break;
      }
    } catch { continue; }
  }

  if (!senderVerified) {
    throw new Error('group-key sender is not the group creator — rejected');
  }

  const groupKey = await unwrapGroupKey(
    encryptedGroupKey, keyNonce, privateBundle, senderIdentityPub, ephemeralPub, opkPrivateKey
  );

  // Re-encrypt the group key with the Argon2id-derived key for at-rest storage
  const { encryptedKey, keyNonce: storedNonce } = await encryptGroupKey(groupKey, identity.derivedKey);

  const group: Group = {
    id:            payload.groupId,
    name:          payload.groupName,
    createdBy:     payload.createdBy,
    createdAt:     payload.createdAt,
    members:       payload.members as GroupMember[],
    encryptedKey,
    keyNonce:      storedNonce,
    keyGeneration: payload.keyGeneration,
    lastKeyDeliveryId: payload.deliveryId,
  };

  await saveGroup(group);
  return group;
}

// ── Group protocol handler ────────────────────────────────────────────────────

export type GroupEventHandler = (event: GroupEvent) => void;

export type GroupEvent =
  | { type: 'group-key-received'; group: Group; senderCircuitAddr?: string }
  | { type: 'group-msg-received'; groupId: string; msg: GroupMessage };

/**
 * Register the /kant/group/1.0.0 protocol handler on the node.
 * Returns a cleanup function.
 */
export async function registerGroupHandler(
  node: Libp2p,
  identity: UnlockedIdentity,
  onEvent: GroupEventHandler
): Promise<void> {
  try { await node.unhandle(GROUP_PROTOCOL); } catch { /* not registered yet */ }
  await node.handle(GROUP_PROTOCOL, async (stream: any) => {
    let deliveryId: string | undefined;
    let ackSent = false;
    const sendAck = async (ack: GroupKeyAck): Promise<void> => {
      await stream.send(frameGroupPayload(ack));
      ackSent = true;
    };
    try {
      const payload = await readGroupPayload<any>(stream);

      if (payload.type === 'group-key') {
        if (typeof payload.deliveryId !== 'string' || payload.deliveryId.length === 0) {
          throw new GroupKeyDeliveryError('group-key deliveryId is required', 'invalid_payload');
        }
        const currentDeliveryId = payload.deliveryId as string;
        deliveryId = currentDeliveryId;

        // An ambiguous network failure can make the sender replay the exact
        // envelope. Acknowledge it without trying to burn the OPK again.
        if (!Number.isSafeInteger(payload.keyGeneration) || payload.keyGeneration < 0) {
          throw new GroupKeyDeliveryError('group-key generation is invalid', 'invalid_payload');
        }
        const existing = await getGroup(payload.groupId);
        if (existing && existing.createdBy !== payload.createdBy) {
          throw new GroupKeyDeliveryError('group creator does not match stored group', 'invalid_payload');
        }
        if (existing && existing.keyGeneration >= payload.keyGeneration) {
          await sendAck({ type: 'group-key-ack', deliveryId: currentDeliveryId, status: 'duplicate' });
          onEvent({ type: 'group-key-received', group: existing });
          return;
        }

        const privateBundle = await buildPrivateBundle(identity);
        // If the sender included an OPK id, burn the OPK to obtain the private
        // half for X3DH DH4 before unwrapping the group key.
        let opkPrivateKey: Uint8Array | undefined = undefined;
        if (payload.opkId && typeof payload.opkId === 'string') {
          try {
            const opk = await getOPK(payload.opkId);
            if (opk) {
              opkPrivateKey = opk.privateKey;
            } else {
              console.warn('[group handler] OPK not found or already burned:', payload.opkId.slice(0, 8));
              throw new GroupKeyDeliveryError('one-time pre-key is unavailable', 'opk_unavailable');
            }
          } catch (e) {
            if (e instanceof GroupKeyDeliveryError) throw e;
            console.warn('[group handler] burnOPK threw:', e);
            throw new GroupKeyDeliveryError('one-time pre-key could not be loaded', 'opk_unavailable');
          }
        }
        const group = await handleIncomingGroupKey(payload, identity, privateBundle, opkPrivateKey);
        // Do not let an unauthenticated or corrupt envelope burn a pre-key.
        // Consumption happens only after X3DH unwrap and persistence succeed.
        if (payload.opkId && typeof payload.opkId === 'string') {
          const burned = await burnOPK(payload.opkId);
          if (!burned) console.warn('[group handler] OPK was consumed concurrently:', payload.opkId.slice(0, 8));
        }
        // Extract sender's current circuit address from the payload
        const senderCircuitAddrs: string[] = payload.senderCircuitAddrs ?? [];
        const senderCircuitAddr = senderCircuitAddrs.find((a: string) => a.includes('/p2p-circuit'));
        await sendAck({ type: 'group-key-ack', deliveryId: currentDeliveryId, status: 'accepted' });
        onEvent({ type: 'group-key-received', group, senderCircuitAddr });
      }
    } catch (e) {
      console.error('[group handler] error:', e);
      if (deliveryId && !ackSent) {
        const reason: GroupKeyAck['reason'] = e instanceof GroupKeyDeliveryError
          ? (e.code === 'invalid_ack' ? 'invalid_payload' : e.code)
          : 'unwrap_failed';
        try {
          await sendAck({ type: 'group-key-ack', deliveryId, status: 'rejected', reason });
        } catch { /* best effort */ }
      }
    } finally {
      try { await stream.close(); } catch { /* best effort */ }
    }
  }, { runOnLimitedConnection: true });
}

// ── Send a group message ──────────────────────────────────────────────────────

export interface GroupReplyRef { id: string; from: string; text: string }

/** Wrap a reply reference into the plaintext that actually gets encrypted —
 *  a quoted snippet is message content, so it rides inside the same AEAD seal
 *  as the body rather than as unauthenticated wire metadata. */
export function encodeGroupText(text: string, replyTo?: GroupReplyRef): string {
  return replyTo ? JSON.stringify({ __kantReply: 1, text, replyTo }) : text;
}

/** Reverse of encodeGroupText. Anything that isn't a recognised envelope is
 *  treated as plain legacy text — keeps old stored/received messages readable. */
export function decodeGroupText(raw: string): { text: string; replyTo?: GroupReplyRef } {
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__kantReply === 1 && typeof parsed.text === 'string') {
        return { text: parsed.text, replyTo: parsed.replyTo };
      }
    } catch { /* not an envelope — fall through to plain text */ }
  }
  return { text: raw };
}

/**
 * Encrypt and broadcast a message to all group members.
 * Uses the existing PING protocol with type='group-msg'.
 * liveAddrs: optional map of publicKeyHex → current circuit addr (overrides stored addr)
 */
export async function sendGroupMessage(
  node: Libp2p,
  group: Group,
  text: string,
  identity: UnlockedIdentity,
  sendPingFn: (node: Libp2p, addr: string, msg: string) => Promise<any>,
  liveAddrs?: Map<string, string>,
  ttlMs?: number,
  replyTo?: GroupReplyRef
): Promise<GroupMessage> {
  const { ciphertext, nonce } = await encryptGroupMessage(encodeGroupText(text, replyTo), group, identity);
  const now = Date.now();

  const msg: GroupMessage = {
    id:            generateId(),
    groupId:       group.id,
    fromPubKeyHex: identity.publicKeyHex,
    ciphertext,
    nonce,
    timestamp:     now,
    keyGeneration: group.keyGeneration,
    expiresAt:     ttlMs ? now + ttlMs : 0,
  };

  const wire = JSON.stringify({
    type:           'group-msg',
    groupId:        group.id,
    msgId:          msg.id,
    fromPubKeyHex:  msg.fromPubKeyHex,
    ciphertext:     Array.from(ciphertext),
    nonce:          Array.from(nonce),
    timestamp:      msg.timestamp,
    keyGeneration:  msg.keyGeneration,
    expiresAt:      msg.expiresAt,
    senderAddrs:    node.getMultiaddrs().map((a: any) => a.toString()).filter((a: string) => a.includes('/p2p-circuit')),
  });

  // Broadcast to all members (except self) in parallel.  A member that fails
  // (relay still re-establishing after a restart, transient yamux stream race,
  // stale reservation) is retried with quadratic backoff up to ~55s total.
  // Without this a single failed circuit dial silently dropped the message for
  // that member — it was persisted as sent on our side and never delivered.
  const targets = group.members.filter(m => m.publicKeyHex !== identity.publicKeyHex);

  const attemptSend = async (members: GroupMember[]): Promise<GroupMember[]> => {
    const failed: GroupMember[] = [];
    await Promise.allSettled(members.map(m => {
      // Prefer live address over stored address
      const addr = liveAddrs?.get(m.publicKeyHex) || m.circuitAddr;
      if (!addr) return Promise.resolve();
      return sendPingFn(node, addr, wire).catch(e => {
        console.warn('[groups] send to', m.publicKeyHex.slice(0, 12), 'failed:', e);
        failed.push(m);
      });
    }));
    return failed;
  };

  let failed = await attemptSend(targets);
  for (let attempt = 1; failed.length > 0 && attempt <= 5; attempt++) {
    await new Promise(r => setTimeout(r, 1000 * attempt * attempt)); // 1, 4, 9, 16, 25s
    failed = await attemptSend(failed);
  }

  await saveGroupMessage(msg);
  return msg;
}

/**
 * Broadcast your current circuit address to all group members.
 * Call this after connecting to the network and after joining a group.
 */
export async function sendGroupPresence(
  node: Libp2p,
  group: Group,
  identity: UnlockedIdentity,
  sendPingFn: (node: Libp2p, addr: string, msg: string) => Promise<any>,
  liveAddrs?: Map<string, string>
): Promise<void> {
  const myAddrs = node.getMultiaddrs()
    .map((a: any) => a.toString())
    .filter((a: string) => a.includes('/p2p-circuit'));

  if (myAddrs.length === 0) return;

  const wire = JSON.stringify({
    type:          'group-presence',
    groupId:       group.id,
    fromPubKeyHex: identity.publicKeyHex,
    circuitAddrs:  myAddrs,
    timestamp:     Date.now(),
  });

  const sends = group.members
    .filter(m => m.publicKeyHex !== identity.publicKeyHex)
    .map(m => {
      // ONLY use live addresses — never stale stored ones
      // If we don't know their current address, skip — they'll get our presence
      // when they send us a message (senderAddrs in group-msg) or their own presence
      const addr = liveAddrs?.get(m.publicKeyHex);
      if (!addr) return Promise.resolve();
      return sendPingFn(node, addr, wire).catch(() => { /* non-fatal */ });
    });

  await Promise.allSettled(sends);
}


export async function handleIncomingGroupMsg(
  payload: any,
  identity: UnlockedIdentity
): Promise<GroupMessage | null> {
  const db    = await openDB();
  const group = await idbGet<Group>(db, 'groups', payload.groupId);
  db.close();

  if (!group) {
    console.warn('[groups] received msg for unknown group', String(payload.groupId).replace(/[\r\n]/g, '').slice(0, 64));
    return null;
  }

  const ciphertext = new Uint8Array(Object.values(payload.ciphertext));
  const nonce      = new Uint8Array(Object.values(payload.nonce));

  // Decrypt to verify the key works — result stored as plaintext in GroupMessage via caller
  await decryptGroupMessage(ciphertext, nonce, group, identity);

  const msg: GroupMessage = {
    id:            payload.msgId,
    groupId:       payload.groupId,
    fromPubKeyHex: payload.fromPubKeyHex,
    ciphertext,
    nonce,
    timestamp:     payload.timestamp,
    keyGeneration: payload.keyGeneration,
    expiresAt:     payload.expiresAt ?? 0,
  };

  await saveGroupMessage(msg);
  return msg;
}
