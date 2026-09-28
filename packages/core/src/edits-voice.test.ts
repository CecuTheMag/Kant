import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_NAME } from './db.js';
import { getSodium } from './sodium.js';
import { CAP_MESSAGE_EDIT, EDIT_LIMITS, SUPPORTED_CAPS, decodeContent, encodeContent, sanitizeEditRef } from './envelope.js';
import { VOICE_LIMITS, sanitizeGroupRef, sanitizeVoiceMeta } from './voice.js';
import { editStoredMessage, getConversation, saveMessage } from './messages.js';
import {
  createGroup, decodeGroupText, decryptGroupMessage, encodeGroupText, getGroupMessages, saveGroupFileRecord,
  saveGroupMessage, type GroupMember,
} from './groups.js';
import type { UnlockedIdentity } from './identity.js';

const PEER = 'b'.repeat(64);

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('deletion blocked'));
  });
}

afterEach(deleteDatabase);

async function makeIdentity(): Promise<UnlockedIdentity> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  return { publicKeyHex: sodium.to_hex(kp.publicKey), publicKey: kp.publicKey, privateKey: kp.privateKey, derivedKey: sodium.randombytes_buf(32) };
}

describe('edit envelopes', () => {
  test('an edit round-trips and is advertised as a capability', () => {
    const decoded = decodeContent(encodeContent('fixed typo', undefined, { edit: { id: 'm-9' } }));
    assert.deepEqual(decoded, { text: 'fixed typo', replyTo: undefined, edit: { id: 'm-9' }, enveloped: true });
    assert.ok(SUPPORTED_CAPS.includes(CAP_MESSAGE_EDIT));
  });

  test('an edit and a reply can share one envelope', () => {
    const reply = { id: 'r', from: 'Ana', text: 'q' };
    const decoded = decodeContent(encodeContent('a', reply, { edit: { id: 'e' } }));
    assert.deepEqual(decoded.replyTo, reply);
    assert.deepEqual(decoded.edit, { id: 'e' });
  });

  test('malformed or oversized edit references are dropped, the text survives', () => {
    for (const bad of [null, 'x', 1, {}, { id: '' }, { id: 5 }, { id: 'i'.repeat(EDIT_LIMITS.id + 1) }]) {
      const decoded = decodeContent(JSON.stringify({ __kantReply: 1, text: 'body', edit: bad }));
      assert.equal(decoded.text, 'body');
      assert.equal(decoded.edit, undefined);
    }
    assert.equal(sanitizeEditRef({ id: 'ok', extra: 1 })!.id, 'ok');
    assert.equal(Object.keys(sanitizeEditRef({ id: 'ok', extra: 1 })!).length, 1);
  });

  test('plain text with no reply or edit stays byte-identical', () => {
    assert.equal(encodeContent('hi', undefined, {}), 'hi');
    assert.equal(encodeContent('hi', undefined, { edit: { id: '' } }), 'hi');
  });

  test('group codec carries edits too', () => {
    const wire = encodeGroupText('new', undefined, { edit: { id: 'g1' } });
    assert.deepEqual(decodeGroupText(wire), { text: 'new', edit: { id: 'g1' } });
    assert.deepEqual(decodeGroupText('plain'), { text: 'plain' });
  });
});

describe('voice metadata', () => {
  test('valid metadata passes through, rounded', () => {
    assert.deepEqual(sanitizeVoiceMeta({ durationMs: 1234.6, waveform: [0, 50.4, 100] }), { durationMs: 1235, waveform: [0, 50, 100] });
  });

  test('hostile values are clamped or rejected', () => {
    assert.equal(sanitizeVoiceMeta(null), undefined);
    assert.equal(sanitizeVoiceMeta({ durationMs: -1, waveform: [] }), undefined);
    assert.equal(sanitizeVoiceMeta({ durationMs: Number.NaN }), undefined);
    assert.equal(sanitizeVoiceMeta({ durationMs: '5' }), undefined);
    const huge = sanitizeVoiceMeta({ durationMs: 1e12, waveform: Array.from({ length: 5000 }, () => 9999) })!;
    assert.equal(huge.durationMs, VOICE_LIMITS.maxDurationMs);
    assert.equal(huge.waveform.length, VOICE_LIMITS.waveformBars);
    assert.ok(huge.waveform.every(v => v === 100));
    assert.deepEqual(sanitizeVoiceMeta({ durationMs: 10, waveform: ['x', -5, null] })!.waveform, [0, 0, 0]);
    assert.deepEqual(sanitizeVoiceMeta({ durationMs: 10, waveform: 'nope' })!.waveform, []);
  });

  test('group references are bounded strings', () => {
    assert.equal(sanitizeGroupRef('g-1'), 'g-1');
    for (const bad of ['', 5, null, 'g'.repeat(129)]) assert.equal(sanitizeGroupRef(bad), undefined);
  });
});

describe('editStoredMessage', () => {
  test('replaces the text of our own message and records when', async () => {
    const key = (await makeIdentity()).derivedKey;
    await saveMessage(PEER, key, { id: 'm1', fromMe: true, text: 'teh', timestamp: 1, status: 'sent' });
    assert.equal(await editStoredMessage(PEER, key, 'm1', 'the', 50, true), true);
    const conv = await getConversation(PEER, key);
    assert.equal(conv!.messages[0].text, 'the');
    assert.equal(conv!.messages[0].editedAt, 50);
  });

  test('a peer cannot rewrite our message, and unknown ids are ignored', async () => {
    const key = (await makeIdentity()).derivedKey;
    await saveMessage(PEER, key, { id: 'mine', fromMe: true, text: 'original', timestamp: 1, status: 'sent' });
    assert.equal(await editStoredMessage(PEER, key, 'mine', 'forged', 2, false), false);
    assert.equal(await editStoredMessage(PEER, key, 'missing', 'x', 2, false), false);
    assert.equal(await editStoredMessage('c'.repeat(64), key, 'mine', 'x', 2, true), false);
    assert.equal((await getConversation(PEER, key))!.messages[0].text, 'original');
  });

  test('an older edit arriving late does not overwrite a newer one', async () => {
    const key = (await makeIdentity()).derivedKey;
    await saveMessage(PEER, key, { id: 't', fromMe: false, text: 'v1', timestamp: 1, status: 'delivered' });
    assert.equal(await editStoredMessage(PEER, key, 't', 'v3', 300, false), true);
    assert.equal(await editStoredMessage(PEER, key, 't', 'v2', 200, false), false);
    assert.equal((await getConversation(PEER, key))!.messages[0].text, 'v3');
  });
});

describe('group file records', () => {
  test('a file record persists with its attachment and an empty encrypted body', async () => {
    const identity = await makeIdentity();
    const self: GroupMember = { publicKeyHex: identity.publicKeyHex, circuitAddr: '', joinedAt: 1 };
    const group = await createGroup('Voice', [self], identity);
    const attachment = {
      fileId: 'f1', fileName: 'Voice message.webm', mimeType: 'audio/webm', fileSize: 10, sha256: '',
      display: 'attachment' as const, voice: { durationMs: 4000, waveform: [1, 2, 3] },
    };
    await saveGroupFileRecord({ id: 'f1', groupId: group.id, fromPubKeyHex: identity.publicKeyHex, timestamp: 5, attachment }, group, identity);
    // Saving the same id again (a retried transfer) keeps one row.
    await saveGroupFileRecord({ id: 'f1', groupId: group.id, fromPubKeyHex: identity.publicKeyHex, timestamp: 5, attachment }, group, identity);
    const rows = await getGroupMessages(group.id);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].attachment, attachment);
    assert.equal(await decryptGroupMessage(rows[0].ciphertext, rows[0].nonce, group, identity), '');
  });

  test('duplicate group messages are stored once', async () => {
    const identity = await makeIdentity();
    const self: GroupMember = { publicKeyHex: identity.publicKeyHex, circuitAddr: '', joinedAt: 1 };
    const group = await createGroup('Dupes', [self], identity);
    const row = {
      id: 'dup', groupId: group.id, fromPubKeyHex: 'x', ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]),
      timestamp: 1, keyGeneration: 0, expiresAt: 0,
    };
    await saveGroupMessage(row);
    await saveGroupMessage(row);
    assert.equal((await getGroupMessages(group.id)).length, 1);
  });
});
