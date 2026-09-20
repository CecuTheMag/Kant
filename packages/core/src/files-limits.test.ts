import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Libp2p } from 'libp2p';
import { registerFileHandler, type FileMeta } from './files.js';
import { getSodium } from './sodium.js';

function frame(value: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const output = new Uint8Array(4 + body.length);
  new DataView(output.buffer).setUint32(0, body.length, false);
  output.set(body, 4);
  return output;
}

function decode(value: Uint8Array): any {
  return JSON.parse(new TextDecoder().decode(value.subarray(4)));
}

function mockStream(remotePeer: string) {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const pending = new Map<string, any[]>();
  const sent: Uint8Array[] = [];
  let notifySend: (() => void) | undefined;
  return {
    stream: {
      remotePeer,
      addEventListener(type: string, listener: (event: any) => void) {
        const values = listeners.get(type) ?? [];
        values.push(listener);
        listeners.set(type, values);
        for (const event of pending.get(type) ?? []) listener(event);
        pending.delete(type);
      },
      async send(value: Uint8Array) {
        sent.push(Uint8Array.from(value));
        notifySend?.();
      },
      async close() {},
    },
    emit(type: string, event: any = {}) {
      const values = listeners.get(type) ?? [];
      if (!values.length) {
        const events = pending.get(type) ?? [];
        events.push(event);
        pending.set(type, events);
      } else {
        for (const listener of values) listener(event);
      }
    },
    send(value: unknown) {
      this.emit('message', { data: frame(value) });
    },
    async nextSent(): Promise<any> {
      if (!sent.length) await new Promise<void>(resolve => { notifySend = resolve; });
      notifySend = undefined;
      return decode(sent.shift()!);
    },
  };
}

test('receiver rejects excess per-peer transfers as busy and releases the slot', async () => {
  const sodium = await getSodium();
  const recipient = sodium.crypto_box_keypair();
  const keyMaterial = sodium.randombytes_buf(56);
  const sealedKey = sodium.crypto_box_seal(keyMaterial, recipient.publicKey);
  let handler: ((stream: any) => Promise<void>) | undefined;
  const node = {
    async handle(_protocol: string, callback: (stream: any) => Promise<void>) { handler = callback; },
  } as unknown as Libp2p;
  const errors: Error[] = [];

  await registerFileHandler(node, {
    onMeta: async () => 'accept',
    onChunk: async () => {},
    onProgress: () => {},
    onComplete: () => {},
    onError: error => errors.push(error),
  }, {
    recipientX25519: recipient,
    maxConcurrentPerPeer: 1,
    maxConcurrentTotal: 2,
  });
  assert.ok(handler);

  const meta = (fileId: string): FileMeta => ({
    type: 'file-meta', fileId, fileName: `${fileId}.bin`, mimeType: 'application/octet-stream',
    fileSize: 1, chunkSize: 1, totalChunks: 1, sha256: 'sha256:unused',
    sealedKey: Array.from(sealedKey), display: 'attachment',
  });

  const first = mockStream('same-peer');
  const firstRun = handler!(first.stream);
  first.send(meta('first'));
  assert.equal((await first.nextSent()).type, 'file-accept');

  const second = mockStream('same-peer');
  const secondRun = handler!(second.stream);
  second.send(meta('second'));
  assert.deepEqual(await second.nextSent(), { type: 'file-reject', fileId: 'second', reason: 'busy' });
  await secondRun;

  first.emit('close', { error: new Error('test shutdown') });
  await firstRun;
  assert.equal(errors.length, 1);

  const third = mockStream('same-peer');
  const thirdRun = handler!(third.stream);
  third.send(meta('third'));
  assert.equal((await third.nextSent()).type, 'file-accept', 'slot is released after transfer failure');
  third.emit('close', { error: new Error('test shutdown') });
  await thirdRun;
});

test('receiver validates concurrency limits at registration', async () => {
  const node = { async handle() {} } as unknown as Libp2p;
  const recipientX25519 = { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) };
  const callbacks = {
    onMeta: async () => 'accept' as const,
    onChunk: async () => {},
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
  };
  await assert.rejects(
    registerFileHandler(node, callbacks, { recipientX25519, maxConcurrentPerPeer: 0 }),
    /positive integer/
  );
  await assert.rejects(
    registerFileHandler(node, callbacks, { recipientX25519, maxConcurrentTotal: -1 }),
    /positive integer/
  );
});
