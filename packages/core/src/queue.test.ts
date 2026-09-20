import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import 'fake-indexeddb/auto';
import type { Libp2p } from 'libp2p';
import { dequeue, enqueue, getPendingForContact, startQueueRetry } from './queue.js';
import { DB_NAME, idbPut, openDB } from './db.js';

const CONTACT_PUBLIC_KEY = 'contact-public-key';
const EMBEDDED_ADDR = '/ip4/127.0.0.1/tcp/4001/p2p/stale-peer';
const LIVE_ADDR = '/ip4/127.0.0.1/tcp/4002/p2p/live-peer';

interface ManualInterval {
  delay: number;
  cleared: boolean;
  fire(): void;
}

function installManualIntervals(): { intervals: ManualInterval[]; restore(): void } {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const intervals: ManualInterval[] = [];

  globalThis.setInterval = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    const interval: ManualInterval = {
      delay: Number(delay ?? 0),
      cleared: false,
      fire() {
        if (!interval.cleared) callback(...args);
      },
    };
    intervals.push(interval);
    return interval as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  globalThis.clearInterval = ((interval: ReturnType<typeof setInterval>) => {
    (interval as unknown as ManualInterval).cleared = true;
  }) as typeof clearInterval;

  return {
    intervals,
    restore() {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    },
  };
}

function installManualClock(start: number): { advance(ms: number): void; restore(): void } {
  const realDateNow = Date.now;
  let current = start;
  Date.now = () => current;
  return {
    advance(ms: number) {
      current += ms;
    },
    restore() {
      Date.now = realDateNow;
    },
  };
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await nextTurn();
  }
  assert.fail(message);
}

async function waitForPendingCount(contactPubkeyHex: string, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await getPendingForContact(contactPubkeyHex)).length === expected) return;
    await nextTurn();
  }
  assert.fail(`expected ${expected} pending message(s) for ${contactPubkeyHex}`);
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB ${DB_NAME} deletion blocked`));
  });
}

async function saveContact(publicKeyHex: string): Promise<void> {
  const database = await openDB();
  await idbPut(database, 'contacts', { publicKeyHex });
  database.close();
}

beforeEach(deleteDatabase);
afterEach(deleteDatabase);

test('periodically retries after a transient failure and keeps ciphertext until ACK', async () => {
  const intervals = installManualIntervals();
  const clock = installManualClock(1_000_000);
  let cleanup: (() => void) | undefined;

  try {
    const queued = {
      id: 'queued-message-1',
      contactPubkeyHex: CONTACT_PUBLIC_KEY,
      peerCircuitAddr: EMBEDDED_ADDR,
      wirePayload: '{"type":"message","ciphertext":"exact-queued-ciphertext"}',
      timestamp: 123,
    };
    await saveContact(CONTACT_PUBLIC_KEY);
    await enqueue(queued);

    const attempts: Array<{ wirePayload: string; peerCircuitAddr: string }> = [];
    const delivered: string[] = [];
    let failFirstAttempt = true;
    cleanup = startQueueRetry(
      {} as Libp2p,
      async (wirePayload, peerCircuitAddr) => {
        attempts.push({ wirePayload, peerCircuitAddr });
        if (failFirstAttempt) {
          failFirstAttempt = false;
          throw new Error('transient network failure');
        }
      },
      messageId => delivered.push(messageId),
      contactPubkeyHex => contactPubkeyHex === CONTACT_PUBLIC_KEY ? LIVE_ADDR : undefined,
    );

    await waitFor(() => attempts.length === 1, 'initial queue drain did not attempt delivery');
    await nextTurn();
    assert.equal(intervals.intervals.length, 1);
    assert.equal(intervals.intervals[0].delay, 5_000);
    assert.deepEqual(await getPendingForContact(CONTACT_PUBLIC_KEY), [{ ...queued, retries: 0 }]);

    // The failed attempt applies the production 15-second backoff. Advance the
    // clock before firing the captured production 5-second poll callback.
    clock.advance(20_000);
    intervals.intervals[0].fire();
    await waitFor(() => delivered.length === 1, 'periodic queue drain did not deliver the message');

    assert.deepEqual(attempts, [
      { wirePayload: queued.wirePayload, peerCircuitAddr: LIVE_ADDR },
      { wirePayload: queued.wirePayload, peerCircuitAddr: LIVE_ADDR },
    ]);
    assert.deepEqual(delivered, [queued.id]);
    assert.deepEqual(await getPendingForContact(CONTACT_PUBLIC_KEY), [{ ...queued, retries: 0 }]);
  } finally {
    cleanup?.();
    clock.restore();
    intervals.restore();
  }
});

test('cleanup stops polling before a later queued message can be sent', async () => {
  const intervals = installManualIntervals();
  let cleanup: (() => void) | undefined;

  try {
    const firstMessage = {
      id: 'queued-message-before-cleanup',
      contactPubkeyHex: CONTACT_PUBLIC_KEY,
      peerCircuitAddr: EMBEDDED_ADDR,
      wirePayload: '{"type":"message","ciphertext":"first-ciphertext"}',
      timestamp: 456,
    };
    await saveContact(CONTACT_PUBLIC_KEY);
    await enqueue(firstMessage);

    const attempts: string[] = [];
    cleanup = startQueueRetry(
      {} as Libp2p,
      async wirePayload => {
        attempts.push(wirePayload);
      },
      () => {},
      () => LIVE_ADDR,
    );

    await waitFor(() => attempts.length === 1, 'initial queue drain did not deliver the first message');
    await dequeue(firstMessage.id); // recipient ACK
    await waitForPendingCount(CONTACT_PUBLIC_KEY, 0);

    cleanup();
    cleanup = undefined;
    assert.equal(intervals.intervals.length, 1);
    assert.equal(intervals.intervals[0].cleared, true);

    const laterMessage = {
      id: 'queued-message-after-cleanup',
      contactPubkeyHex: CONTACT_PUBLIC_KEY,
      peerCircuitAddr: EMBEDDED_ADDR,
      wirePayload: '{"type":"message","ciphertext":"later-ciphertext"}',
      timestamp: 789,
    };
    await enqueue(laterMessage);
    intervals.intervals[0].fire();
    await nextTurn();

    assert.deepEqual(attempts, [firstMessage.wirePayload]);
    assert.deepEqual(await getPendingForContact(CONTACT_PUBLIC_KEY), [{ ...laterMessage, retries: 0 }]);
  } finally {
    cleanup?.();
    intervals.restore();
  }
});
