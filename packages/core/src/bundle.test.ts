import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_NAME, idbGetAll, idbPut, openDB } from './db.js';
import { createIdentity, hasIdentity, unlockIdentityChecked, wipeIdentity } from './identity.js';
import { addContact, getContacts } from './contacts.js';
import { getConversation, saveMessage } from './messages.js';
import { createBackupFile, isBackupFile, restoreBackupFile } from './bundle.js';
import { encodeMoveCode, parseMoveCode } from './transfer.js';

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

const PEER = 'c'.repeat(64);

async function seed(password: string) {
  const identity = await createIdentity(password);
  await addContact(PEER, 'Carol');
  await saveMessage(PEER, identity.derivedKey, { id: 'm1', fromMe: true, text: 'hello **Carol**', timestamp: 5, status: 'delivered' });
  const db = await openDB();
  await idbPut(db, 'ratchets', { contactPubkeyHex: PEER, blob: new Uint8Array([9, 9]), updatedAt: 1 });
  await idbPut(db, 'files', { fileId: 'f1', ciphertext: new Uint8Array(200_000).fill(7), nonce: new Uint8Array(24), fileName: 'big.bin', mimeType: 'application/octet-stream', fileSize: 200_000, timestamp: 1 });
  db.close();
  return identity;
}

describe('backup file', () => {
  test('round-trips an identity with contacts, messages and files — but not sessions', async () => {
    const identity = await seed('backup pw 1');
    const file = await createBackupFile('backup pw 1', { includeFiles: true, settings: { kant_profile_name: 'Me' } });
    assert.ok(isBackupFile(file));
    await wipeIdentity();
    assert.equal(await hasIdentity(), false);

    const summary = await restoreBackupFile(file, 'backup pw 1');
    assert.equal(summary.publicKeyHex, identity.publicKeyHex);
    assert.deepEqual(summary.settings, { kant_profile_name: 'Me' });
    const unlocked = await unlockIdentityChecked('backup pw 1');
    assert.equal(unlocked.kind, 'ok');
    assert.equal((await getContacts())[0].nickname, 'Carol');
    const conv = await getConversation(PEER, (unlocked as any).identity.derivedKey);
    assert.equal(conv!.messages[0].text, 'hello **Carol**');
    const db = await openDB();
    assert.equal((await idbGetAll<any>(db, 'files'))[0].ciphertext.length, 200_000);
    assert.deepEqual(await idbGetAll(db, 'ratchets'), []);
    db.close();
  });

  test('refuses a wrong password — at export and at restore — and leaves nothing behind', async () => {
    await seed('right one');
    await assert.rejects(createBackupFile('wrong one', { includeFiles: false }), /WRONG_PASSWORD/);
    const file = await createBackupFile('right one', { includeFiles: false });
    await wipeIdentity();
    await assert.rejects(restoreBackupFile(file, 'wrong one'), /WRONG_PASSWORD/);
    assert.equal(await hasIdentity(), false);
  });

  test('detects tampering and truncation, and never restores over an identity', async () => {
    await seed('pw pw pw');
    const file = await createBackupFile('pw pw pw', { includeFiles: true });
    await assert.rejects(restoreBackupFile(file, 'pw pw pw'), /IDENTITY_EXISTS/);
    await wipeIdentity();

    const tampered = file.slice();
    tampered[tampered.length - 20] ^= 1;
    await assert.rejects(restoreBackupFile(tampered, 'pw pw pw'));
    assert.equal(await hasIdentity(), false);

    await assert.rejects(restoreBackupFile(file.slice(0, file.length - 100), 'pw pw pw'));
    assert.equal(await hasIdentity(), false);

    assert.equal(isBackupFile(new TextEncoder().encode('not a backup')), false);
    await assert.rejects(restoreBackupFile(new Uint8Array(10), 'x'), /NOT_A_BACKUP/);

    // The untouched file still restores after all that.
    assert.equal((await restoreBackupFile(file, 'pw pw pw')).records > 0, true);
  });
});

describe('move code', () => {
  test('encodes the one-time key and circuit address, and rejects anything else', async () => {
    const addr = '/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWBV9EG7cYz5iU5iSh875UrRCauoNqNZ9qP3doSz3dByqQ/p2p-circuit/p2p/12D3KooWHfNGRqBYP1oTnsHVfV8Gq7NamgJrdw3BGzCyP5bcww5z';
    const key = new Uint8Array(32).fill(3);
    const code = await encodeMoveCode(key, addr);
    const parsed = await parseMoveCode(`scan: ${code}`);
    assert.deepEqual(parsed?.publicKey, key);
    assert.equal(parsed?.addr, addr);
    assert.equal(await parseMoveCode('kant-move:1:abc:/ip4/1.2.3.4'), null);
    assert.equal(await parseMoveCode('https://kant.network/add#x'), null);
  });
});
