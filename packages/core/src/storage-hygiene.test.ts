import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_NAME, STORES, idbGetAll, idbPut, openDB } from './db.js';
import { createIdentity, hasIdentity, wipeIdentity } from './identity.js';
import { addContact, addContactCaps, getContact } from './contacts.js';
import { enqueue, getPendingForContact, scrubQueuedLegacyWireFields } from './queue.js';
import { CAP_CONTENT_ENVELOPE } from './envelope.js';

const HEX = 'a'.repeat(64);

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('deletion blocked'));
  });
}

afterEach(deleteDatabase);

describe('wipeIdentity', () => {
  test('empties every store, including ones added after the wipe was written', async () => {
    await createIdentity('correct horse battery staple');
    await addContact(HEX, 'Storm');
    const db = await openDB();
    await idbPut(db, 'ratchets', { contactPubkeyHex: HEX, blob: new Uint8Array([1]), updatedAt: 1 });
    await idbPut(db, 'delivery_queue', { groupId: 'g', payload: 'x' });
    await idbPut(db, 'files', { fileId: 'f', ciphertext: new Uint8Array([1]) });
    db.close();

    await wipeIdentity();

    assert.equal(await hasIdentity(), false);
    const after = await openDB();
    for (const { name } of Object.values(STORES)) {
      assert.deepEqual(await idbGetAll(after, name), [], `store ${name} survived the wipe`);
    }
    after.close();
  });
});

describe('contact capabilities', () => {
  test('caps are recorded and only ever widened', async () => {
    await addContact(HEX, 'Storm');
    assert.equal(await addContactCaps(HEX, [CAP_CONTENT_ENVELOPE]), true);
    assert.equal(await addContactCaps(HEX, [CAP_CONTENT_ENVELOPE]), false);
    assert.equal(await addContactCaps(HEX, []), false);
    assert.deepEqual((await getContact(HEX))?.caps, [CAP_CONTENT_ENVELOPE]);
    assert.equal(await addContactCaps(HEX, ['future-cap']), true);
    assert.deepEqual((await getContact(HEX))?.caps, [CAP_CONTENT_ENVELOPE, 'future-cap']);
  });

  test('caps for an unknown sender do not create a contact', async () => {
    assert.equal(await addContactCaps(HEX, [CAP_CONTENT_ENVELOPE]), false);
    assert.equal(await getContact(HEX), undefined);
  });

  test('addContact keeps previously learned caps', async () => {
    await addContact(HEX, 'Storm');
    await addContactCaps(HEX, [CAP_CONTENT_ENVELOPE]);
    await addContact(HEX, 'Renamed');
    assert.deepEqual((await getContact(HEX))?.caps, [CAP_CONTENT_ENVELOPE]);
  });
});

describe('queued legacy payloads', () => {
  test('scrub rewrites only payloads that carry a plaintext reply snippet', async () => {
    const legacy = JSON.stringify({ id: '1', replyTo: { id: 'x', from: 'y', text: 'secret quote' }, ciphertext: [1] });
    const current = JSON.stringify({ id: '2', ciphertext: [2] });
    await enqueue({ id: '1', contactPubkeyHex: HEX, peerCircuitAddr: '', wirePayload: legacy, timestamp: 1 });
    await enqueue({ id: '2', contactPubkeyHex: HEX, peerCircuitAddr: '', wirePayload: current, timestamp: 2 });

    assert.equal(await scrubQueuedLegacyWireFields(), 1);
    assert.equal(await scrubQueuedLegacyWireFields(), 0);

    const pending = await getPendingForContact(HEX);
    const byId = new Map(pending.map(m => [m.id, m]));
    assert.equal(byId.get('1')!.wirePayload.includes('secret quote'), false);
    assert.deepEqual(JSON.parse(byId.get('1')!.wirePayload), { id: '1', ciphertext: [1] });
    assert.equal(byId.get('2')!.wirePayload, current);
  });
});
