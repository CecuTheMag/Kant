import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_NAME, idbGet, idbPut, openDB } from './db.js';
import {
  createIdentity, isDuressPasswordSet, setDuressPassword, unlockIdentity, unlockIdentityChecked, unlockIdentityWithKey,
} from './identity.js';

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

async function storedRecord(): Promise<any> {
  const db = await openDB();
  try { return await idbGet<any>(db, 'identity', 'keypair'); } finally { db.close(); }
}

describe('duress password', () => {
  test('tells the real password, the duress password and a wrong one apart', async () => {
    const identity = await createIdentity('correct horse');
    await setDuressPassword(identity, 'panic button');
    assert.equal((await unlockIdentityChecked('correct horse')).kind, 'ok');
    assert.equal((await unlockIdentityChecked('panic button')).kind, 'duress');
    assert.equal((await unlockIdentityChecked('nope')).kind, 'wrong');
    // The legacy entry point never reports duress — it's simply not the password.
    assert.equal(await unlockIdentity('panic button'), null);
  });

  test('a record looks the same whether or not a duress password is set', async () => {
    const identity = await createIdentity('pw one');
    const before = await storedRecord();
    await setDuressPassword(identity, 'pw two');
    const after = await storedRecord();
    assert.equal(before.duress.verifier.length, after.duress.verifier.length);
    assert.equal(before.duress.salt.length, after.duress.salt.length);
    assert.equal(before.duressMark.ciphertext.length, after.duressMark.ciphertext.length);
    assert.equal(await isDuressPasswordSet(identity), true);
    await setDuressPassword(identity, null);
    assert.equal(await isDuressPasswordSet(identity), false);
    assert.equal((await unlockIdentityChecked('pw two')).kind, 'wrong');
  });

  test('refuses the real password as the duress password', async () => {
    const identity = await createIdentity('same');
    await assert.rejects(setDuressPassword(identity, 'same'), /SAME_AS_PASSWORD/);
  });

  test('an identity from before duress support is upgraded on unlock', async () => {
    await createIdentity('old user');
    const record = await storedRecord();
    delete record.duress;
    delete record.duressMark;
    const db = await openDB();
    await idbPut(db, 'identity', record, 'keypair');
    db.close();
    const result = await unlockIdentityChecked('old user');
    assert.equal(result.kind, 'ok');
    const upgraded = await storedRecord();
    assert.equal(upgraded.duress.verifier.length, 32);
    assert.equal(await isDuressPasswordSet((result as any).identity), false);
  });
});

describe('unlock with the derived key (biometrics)', () => {
  test('opens with the right key only', async () => {
    const identity = await createIdentity('bio');
    const again = await unlockIdentityWithKey(identity.derivedKey);
    assert.equal(again?.publicKeyHex, identity.publicKeyHex);
    assert.equal(await unlockIdentityWithKey(new Uint8Array(32)), null);
    assert.equal(await unlockIdentityWithKey(new Uint8Array(5)), null);
  });
});
