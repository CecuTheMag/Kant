import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Libp2p } from 'libp2p';
import { getSodium } from './sodium.js';
import { registerFileHandler, sendFile } from './files.js';

function decodeFrame(data: Uint8Array): any {
  const length = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false);
  return JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + length)));
}

function encodeFrame(value: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  return frame;
}

function memoryTransport(options: { legacyReceiver?: boolean } = {}) {
  let receiverHandler: ((stream: any, connection?: any) => Promise<void>) | undefined;
  let inFlight = 0;
  let maxInFlight = 0;
  let sawCompactChunk = false;
  let sawLegacyChunk = false;

  const makeStream = () => {
    const listeners = new Map<string, Array<(event: any) => void>>();
    const pending = new Map<string, any[]>();
    return {
      addEventListener(type: string, listener: (event: any) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        for (const event of pending.get(type) ?? []) listener(event);
        pending.delete(type);
      },
      emit(type: string, event: any) {
        const current = listeners.get(type) ?? [];
        if (current.length === 0) {
          pending.set(type, [...(pending.get(type) ?? []), event]);
          return;
        }
        for (const listener of current) listener(event);
      },
      async close() {},
      async send(_data: Uint8Array) {},
    };
  };

  const receiverNode = {
    async handle(_protocol: string, handler: (stream: any, connection?: any) => Promise<void>) {
      receiverHandler = handler;
    },
  } as unknown as Libp2p;

  const connection = {
    status: 'open',
    remotePeer: { toString: () => 'receiver' },
    async newStream() {
      assert.ok(receiverHandler, 'receiver handler must be registered');
      const senderStream = makeStream();
      const receiverStream = makeStream();

      senderStream.send = async (data: Uint8Array) => {
        let message = decodeFrame(data);
        if (options.legacyReceiver && message.type === 'file-meta') {
          message = { ...message, capabilities: undefined };
          data = encodeFrame(message);
        }
        if (message.type === 'file-chunk') {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          sawCompactChunk ||= typeof message.data === 'string';
          sawLegacyChunk ||= Array.isArray(message.data);
        }
        queueMicrotask(() => receiverStream.emit('message', { data }));
      };
      receiverStream.send = async (data: Uint8Array) => {
        const message = decodeFrame(data);
        if (message.type === 'file-chunk-ack') inFlight = Math.max(0, inFlight - 1);
        queueMicrotask(() => senderStream.emit('message', { data }));
      };

      void receiverHandler(receiverStream, { remotePeer: { toString: () => 'sender' } });
      return senderStream;
    },
  };

  const senderNode = {
    getConnections: () => [connection],
  } as unknown as Libp2p;

  return {
    receiverNode,
    senderNode,
    stats: () => ({ maxInFlight, sawCompactChunk, sawLegacyChunk }),
  };
}

async function transfer(options: { legacyReceiver?: boolean; failPersistence?: boolean; size?: number } = {}) {
  const sodium = await getSodium();
  const recipient = sodium.crypto_box_keypair();
  const transport = memoryTransport({ legacyReceiver: options.legacyReceiver });
  const source = Uint8Array.from({ length: options.size ?? 1024 * 1024 + 31 }, (_, index) => index % 251);
  let received: Uint8Array | undefined;
  let receiverError: Error | undefined;

  await registerFileHandler(transport.receiverNode, {
    onMeta: async () => 'accept',
    onChunk: async () => {},
    onProgress: () => {},
    onComplete: async (_fileId, verified, data) => {
      assert.equal(verified, true);
      if (options.failPersistence) throw new Error('test storage failure');
      received = data;
    },
    onError: error => { receiverError = error; },
  }, { recipientX25519: recipient });

  const send = sendFile(transport.senderNode, {
    peerCircuitAddr: '/ip4/127.0.0.1/tcp/1/ws/p2p/relay/p2p-circuit/p2p/receiver',
    fileData: source,
    fileName: 'payload.bin',
    mimeType: 'application/octet-stream',
    recipientX25519Pub: recipient.publicKey,
  });

  if (options.failPersistence) {
    await assert.rejects(send, /receiver storage failed/);
    assert.match(receiverError?.message ?? '', /test storage failure/);
  } else {
    await send;
    assert.deepEqual(received, source);
  }
  return transport.stats();
}

test('negotiated compact transfer is byte-exact and bounds in-flight chunks', async () => {
  const stats = await transfer();
  assert.equal(stats.sawCompactChunk, true);
  assert.equal(stats.sawLegacyChunk, false);
  assert.ok(stats.maxInFlight <= 4, `expected at most 4 in-flight chunks, got ${stats.maxInFlight}`);
});

test('sender falls back to legacy number-array chunks for an old receiver', async () => {
  const stats = await transfer({ legacyReceiver: true });
  assert.equal(stats.sawCompactChunk, false);
  assert.equal(stats.sawLegacyChunk, true);
});

test('receiver persistence failure is reported to the sender', async () => {
  await transfer({ failPersistence: true });
});

test('100 MiB community-limit transfer completes with bounded backpressure', { timeout: 120_000 }, async () => {
  const stats = await transfer({ size: 100 * 1024 * 1024 });
  assert.equal(stats.sawCompactChunk, true);
  assert.ok(stats.maxInFlight <= 4, `expected at most 4 in-flight chunks, got ${stats.maxInFlight}`);
});
