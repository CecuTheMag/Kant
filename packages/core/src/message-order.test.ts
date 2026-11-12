import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_NAME } from './db.js';
import { getSodium } from './sodium.js';
import { decodeContent, encodeContent, sanitizeSentAt } from './envelope.js';
import { getConversation, placeReceived, saveMessage } from './messages.js';

const PEER = 'c'.repeat(64);

async function key(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(32);
}

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('sender send time in the envelope', () => {
  test('round-trips, and plain text with no time stays plain', () => {
    assert.equal(encodeContent('hi'), 'hi');
    const sent = encodeContent('hi', undefined, { at: 1_700_000_000_123 });
    assert.notEqual(sent, 'hi');
    const decoded = decodeContent(sent);
    assert.equal(decoded.text, 'hi');
    assert.equal(decoded.at, 1_700_000_000_123);
    assert.equal(decoded.enveloped, true);
  });

  test('a forged time is dropped, the message still decodes', () => {
    for (const bad of [-1, 0, 1.5, Number.MAX_VALUE, '123', null, {}]) {
      assert.equal(sanitizeSentAt(bad), undefined, String(bad));
      const decoded = decodeContent(JSON.stringify({ __kantReply: 1, text: 'x', at: bad }));
      assert.equal(decoded.text, 'x');
      assert.equal(decoded.at, undefined);
    }
  });
});

describe('placing a message that arrived late', () => {
  test('goes before the first message its sender sent after it', () => {
    const stored = [
      { fromMe: false, sentAt: 200, sequenceNumber: 1, timestamp: 1000 },
      { fromMe: true, sequenceNumber: 2, timestamp: 1005 },
      { fromMe: false, sentAt: 300, sequenceNumber: 3, timestamp: 1010 },
    ];
    assert.deepEqual(placeReceived(stored, 100, 1020), { sequenceNumber: 0.5, timestamp: 999 });
    assert.deepEqual(placeReceived(stored, 250, 1020), { sequenceNumber: 2.5, timestamp: 1009 });
    // Sent after everything stored, or with no time: the end, as before.
    assert.equal(placeReceived(stored, 400, 1020), null);
    assert.equal(placeReceived(stored, undefined, 1020), null);
  });

  test('only the sender\'s own times count, never ours', () => {
    // Our message has no sentAt; a far-off sender clock moves nothing past it.
    const stored = [{ fromMe: true, sequenceNumber: 1, timestamp: 5 }];
    assert.equal(placeReceived(stored, 1, 10), null);
  });

  test('stored and read back in the order sent', async () => {
    const k = await key();
    // Message 0 is re-sent under a new session and arrives after 1 and 2.
    for (const [id, at, t] of [['m1', 101, 1001], ['m2', 102, 1002], ['m0', 100, 1003]] as const) {
      await saveMessage(PEER, k, { id, fromMe: false, text: id, timestamp: t, status: 'delivered', sentAt: at });
    }
    const placedAt = await saveMessage(PEER, k, { id: 'm3', fromMe: false, text: 'm3', timestamp: 1004, status: 'delivered', sentAt: 103 });
    assert.equal(placedAt, 1004);
    const conv = await getConversation(PEER, k);
    assert.deepEqual(conv?.messages.map(m => m.text), ['m0', 'm1', 'm2', 'm3']);
    const times = conv!.messages.map(m => m.timestamp);
    assert.deepEqual([...times].sort((a, b) => a - b), times, 'times agree with the order');
  });

  test('a re-save of a stored message keeps its place and time', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'a', fromMe: false, text: 'a', timestamp: 10, status: 'delivered', sentAt: 2 });
    const first = await saveMessage(PEER, k, { id: 'b', fromMe: false, text: 'b', timestamp: 20, status: 'delivered', sentAt: 1 });
    const again = await saveMessage(PEER, k, { id: 'b', fromMe: false, text: 'b', timestamp: 30, status: 'read', sentAt: 1 });
    assert.equal(first, 9);
    assert.equal(again, 9);
    const conv = await getConversation(PEER, k);
    assert.deepEqual(conv?.messages.map(m => m.id), ['b', 'a']);
  });
});
