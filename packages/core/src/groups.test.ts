import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import {
  createGroup,
  distributeGroupKey,
  getDeliveryQueueStatus,
  processDeliveryQueue,
  type DeliveryTask,
  type GroupMember,
} from './groups.js';
import { DB_NAME, idbGetAll, idbPut, openDB } from './db.js';
import { getSodium } from './sodium.js';
import type { UnlockedIdentity } from './identity.js';
import type { X3DHPublicBundle } from './ratchet.js';
import type { Libp2p } from 'libp2p';

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB ${DB_NAME} deletion blocked`));
  });
}

async function getTasks(): Promise<DeliveryTask[]> {
  const database = await openDB();
  const tasks = await idbGetAll<DeliveryTask>(database, 'delivery_queue');
  database.close();
  return tasks;
}

async function saveTask(task: DeliveryTask): Promise<void> {
  const database = await openDB();
  await idbPut(database, 'delivery_queue', task);
  database.close();
}

async function makeFixture() {
  const sodium = await getSodium();
  const sender = sodium.crypto_sign_keypair();
  const recipientIdentity = sodium.crypto_box_keypair();
  const recipientSignedPreKey = sodium.crypto_box_keypair();
  const recipientOpk = sodium.crypto_box_keypair();

  const identity: UnlockedIdentity = {
    publicKeyHex: sodium.to_hex(sender.publicKey),
    publicKey: sender.publicKey,
    privateKey: sender.privateKey,
    derivedKey: sodium.randombytes_buf(32),
  };
  const member: GroupMember = {
    publicKeyHex: 'recipient-public-key',
    nickname: 'Recipient',
    circuitAddr: '/ip4/127.0.0.1/tcp/3000/ws/p2p/12D3KooWTest/p2p-circuit/p2p/12D3KooWRecipient',
    joinedAt: Date.now(),
  };
  const self: GroupMember = {
    publicKeyHex: identity.publicKeyHex,
    nickname: 'Self',
    circuitAddr: '',
    joinedAt: Date.now(),
  };
  const bundle: X3DHPublicBundle = {
    identityKey: recipientIdentity.publicKey,
    signedPreKey: recipientSignedPreKey.publicKey,
    opkPublicKey: recipientOpk.publicKey,
    opkId: 'opk-stable-retry',
  };

  let dialFailure: Error | null = new Error('relay unavailable');
  let ackStatus: 'accepted' | 'rejected' = 'accepted';
  const sentFrames: Uint8Array[] = [];
  const streamListeners = new Map<string, Array<(event: any) => void>>();
  const stream = {
    send(data: Uint8Array) {
      sentFrames.push(Uint8Array.from(data));
      const payload = decodeFrame(data);
      if (payload.type === 'group-key') {
        const ack = new TextEncoder().encode(JSON.stringify({
          type: 'group-key-ack',
          deliveryId: payload.deliveryId,
          status: ackStatus,
          ...(ackStatus === 'rejected' ? { reason: 'opk_unavailable' } : {}),
        }));
        const framed = new Uint8Array(4 + ack.byteLength);
        new DataView(framed.buffer).setUint32(0, ack.byteLength, false);
        framed.set(ack, 4);
        setTimeout(() => {
          for (const listener of streamListeners.get('message') ?? []) listener({ data: framed });
        }, 0);
      }
    },
    addEventListener(type: string, listener: (event: any) => void) {
      const listeners = streamListeners.get(type) ?? [];
      listeners.push(listener);
      streamListeners.set(type, listeners);
    },
    async close() {},
  };
  const connection = {
    async newStream() {
      return stream;
    },
  };
  const node = {
    getMultiaddrs: () => [],
    async dial() {
      if (dialFailure) throw dialFailure;
      return connection;
    },
  } as unknown as Libp2p;

  return {
    identity,
    member,
    self,
    bundle,
    node,
    sentFrames,
    setDialFailure(error: Error | null) {
      dialFailure = error;
    },
    setAckStatus(status: 'accepted' | 'rejected') {
      ackStatus = status;
    },
  };
}

function decodeFrame(frame: Uint8Array): any {
  assert.ok(frame.byteLength >= 4, 'frame has a length prefix');
  const declared = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0, false);
  assert.equal(declared, frame.byteLength - 4, 'frame length prefix matches payload');
  return JSON.parse(new TextDecoder().decode(frame.subarray(4)));
}

describe('group-key delivery queue', { concurrency: false }, () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  test('queues one OPK envelope when the network send fails', async () => {
    const fixture = await makeFixture();
    const group = await createGroup('Test Group', [fixture.member, fixture.self], fixture.identity);
    const bundles = new Map([[fixture.member.publicKeyHex, fixture.bundle]]);

    const result = await distributeGroupKey(fixture.node, group, fixture.identity, bundles);
    assert.deepEqual(result.sent, []);
    assert.deepEqual(result.failed, [fixture.member.publicKeyHex]);

    const tasks = await getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].keyGeneration, group.keyGeneration);
    assert.equal(tasks[0].payload.opkId, fixture.bundle.opkId);
    assert.equal('sharedSecret' in tasks[0].payload, false, 'shared secret must not be persisted');
    assert.equal((await getDeliveryQueueStatus()).pending, 1);
  });

  test('retries the exact stored envelope and deletes its numeric IDB key', async () => {
    const fixture = await makeFixture();
    const group = await createGroup('Test Group', [fixture.member, fixture.self], fixture.identity);
    const bundles = new Map([[fixture.member.publicKeyHex, fixture.bundle]]);
    await distributeGroupKey(fixture.node, group, fixture.identity, bundles);

    const [queued] = await getTasks();
    queued.nextAttempt = Date.now() - 1;
    await saveTask(queued);
    fixture.setDialFailure(null);

    await processDeliveryQueue(fixture.node, fixture.identity, new Map());

    assert.equal((await getTasks()).length, 0, 'successful retry removes auto-increment numeric key');
    assert.equal(fixture.sentFrames.length, 1);
    const payload = decodeFrame(fixture.sentFrames[0]);
    assert.deepEqual(payload.ephemeralPublic, Array.from(queued.payload.ephemeralPublic));
    assert.deepEqual(payload.encryptedGroupKey, Array.from(queued.payload.encryptedGroupKey));
    assert.deepEqual(payload.keyNonce, Array.from(queued.payload.nonce));
    assert.equal(payload.opkId, queued.payload.opkId);
    assert.equal(payload.deliveryId, queued.payload.deliveryId);
  });

  test('applies exponential backoff without replacing the OPK envelope', async () => {
    const fixture = await makeFixture();
    const group = await createGroup('Test Group', [fixture.member, fixture.self], fixture.identity);
    const bundles = new Map([[fixture.member.publicKeyHex, fixture.bundle]]);
    await distributeGroupKey(fixture.node, group, fixture.identity, bundles);

    const [queued] = await getTasks();
    const originalEphemeral = Array.from(queued.payload.ephemeralPublic);
    queued.attempts = 1;
    queued.nextAttempt = Date.now() - 1;
    await saveTask(queued);
    const before = Date.now();

    await processDeliveryQueue(fixture.node, fixture.identity, new Map());

    const [retried] = await getTasks();
    assert.equal(retried.attempts, 2);
    assert.equal(retried.status, 'pending');
    assert.ok(retried.nextAttempt >= before + 120_000);
    assert.deepEqual(Array.from(retried.payload.ephemeralPublic), originalEphemeral);
  });

  test('marks a delivery failed on the tenth failed attempt', async () => {
    const fixture = await makeFixture();
    const group = await createGroup('Test Group', [fixture.member, fixture.self], fixture.identity);
    const bundles = new Map([[fixture.member.publicKeyHex, fixture.bundle]]);
    await distributeGroupKey(fixture.node, group, fixture.identity, bundles);

    const [queued] = await getTasks();
    queued.attempts = 9;
    queued.nextAttempt = Date.now() - 1;
    await saveTask(queued);

    await processDeliveryQueue(fixture.node, fixture.identity, new Map());

    const [failed] = await getTasks();
    assert.equal(failed.attempts, 10);
    assert.equal(failed.status, 'failed');
    assert.equal((await getDeliveryQueueStatus()).failed, 1);
  });

  test('keeps explicit OPK rejection recoverable and re-wraps only with a fresh bundle', async () => {
    const fixture = await makeFixture();
    const group = await createGroup('Test Group', [fixture.member, fixture.self], fixture.identity);
    await distributeGroupKey(
      fixture.node,
      group,
      fixture.identity,
      new Map([[fixture.member.publicKeyHex, fixture.bundle]])
    );

    const [queued] = await getTasks();
    queued.attempts = 9;
    queued.nextAttempt = Date.now() - 1;
    await saveTask(queued);
    fixture.setDialFailure(null);
    fixture.setAckStatus('rejected');

    const rejected = await processDeliveryQueue(fixture.node, fixture.identity, new Map());
    assert.deepEqual(rejected.opkUnavailable, [fixture.member.publicKeyHex]);
    const [recoverable] = await getTasks();
    assert.equal(recoverable.attempts, 10);
    assert.equal(recoverable.status, 'pending');
    assert.equal(recoverable.failureReason, 'opk_unavailable');
    assert.equal(recoverable.payload.deliveryId, queued.payload.deliveryId);

    const sodium = await getSodium();
    const freshOpk = sodium.crypto_box_keypair();
    const freshBundle: X3DHPublicBundle = {
      ...fixture.bundle,
      opkPublicKey: freshOpk.publicKey,
      opkId: 'opk-after-explicit-rejection',
    };
    fixture.setAckStatus('accepted');
    const replaced = await processDeliveryQueue(
      fixture.node,
      fixture.identity,
      new Map([[fixture.member.publicKeyHex, freshBundle]])
    );

    assert.deepEqual(replaced.sent, [fixture.member.publicKeyHex]);
    assert.equal((await getTasks()).length, 0);
    const rejectedPayload = decodeFrame(fixture.sentFrames[0]);
    const acceptedPayload = decodeFrame(fixture.sentFrames[1]);
    assert.equal(rejectedPayload.deliveryId, queued.payload.deliveryId);
    assert.notEqual(acceptedPayload.deliveryId, rejectedPayload.deliveryId);
    assert.equal(acceptedPayload.opkId, freshBundle.opkId);
  });
});
