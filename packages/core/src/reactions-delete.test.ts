import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { DB_NAME } from './db.js';
import { getSodium } from './sodium.js';
import {
  CAP_MESSAGE_DELETE, CAP_MESSAGE_REACT, SUPPORTED_CAPS, decodeContent, encodeContent, sanitizeReaction,
} from './envelope.js';
import {
  deleteStoredMessage, editStoredMessage, getConversation, markOpSynced, removeStoredMessage, saveMessage, setStoredReaction,
} from './messages.js';
import {
  createGroup, decryptGroupMessage, encryptGroupMessage, getGroupMessages, purgeGroupMessage, saveGroupMessage,
  type Group, type GroupMember,
} from './groups.js';
import type { UnlockedIdentity } from './identity.js';

const PEER = 'b'.repeat(64);

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

describe('reaction and delete envelopes', () => {
  test('advertised and round-trip inside the envelope', () => {
    assert.ok(SUPPORTED_CAPS.includes(CAP_MESSAGE_REACT));
    assert.ok(SUPPORTED_CAPS.includes(CAP_MESSAGE_DELETE));
    const react = decodeContent(encodeContent('', undefined, { react: { id: 'm1', emoji: '👍🏽' } }));
    assert.deepEqual(react.react, { id: 'm1', emoji: '👍🏽' });
    const clear = decodeContent(encodeContent('', undefined, { react: { id: 'm1', emoji: '' } }));
    assert.deepEqual(clear.react, { id: 'm1', emoji: '' });
    const del = decodeContent(encodeContent('', undefined, { del: { id: 'm2' } }));
    assert.deepEqual(del.del, { id: 'm2' });
  });

  test('a reaction must be exactly one emoji', () => {
    for (const ok of ['👍', '❤️', '👨‍👩‍👧', '🇧🇬', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '👍🏿']) assert.equal(sanitizeReaction(ok), ok, ok);
    for (const bad of ['a', 'lol', '👍👍', '<b>', ' ', '👍 ', 'x'.repeat(40), 42, null]) {
      assert.equal(sanitizeReaction(bad), undefined, String(bad));
    }
    // Invalid reactions are dropped from the envelope rather than applied.
    const forged = decodeContent(JSON.stringify({ __kantReply: 1, text: '', react: { id: 'm', emoji: 'click me' } }));
    assert.equal(forged.react, undefined);
  });
});

describe('stored reactions', () => {
  test('are encrypted at rest, per side, and can be cleared', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'm', fromMe: false, text: 'hi', timestamp: 1, status: 'delivered' });
    assert.equal(await setStoredReaction(PEER, k, 'm', 'me', '❤️', 'op1'), true);
    assert.equal(await setStoredReaction(PEER, k, 'm', 'them', '😂'), true);
    let m = (await getConversation(PEER, k))!.messages[0];
    assert.deepEqual(m.reactions, { me: '❤️', them: '😂' });
    assert.deepEqual(m.unsynced, { react: 'op1' });
    await setStoredReaction(PEER, k, 'm', 'me', '');
    m = (await getConversation(PEER, k))!.messages[0];
    assert.deepEqual(m.reactions, { them: '😂' });
    assert.equal(await setStoredReaction(PEER, k, 'missing', 'them', '👍'), false);
  });

  test('survive a re-save of the message', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'm', fromMe: true, text: 'hi', timestamp: 1, status: 'sent' });
    await setStoredReaction(PEER, k, 'm', 'them', '👍');
    await saveMessage(PEER, k, { id: 'm', fromMe: true, text: 'hi', timestamp: 1, status: 'delivered' });
    assert.deepEqual((await getConversation(PEER, k))!.messages[0].reactions, { them: '👍' });
  });
});

describe('delete for everyone', () => {
  test('leaves a tombstone, drops content and scrubs quotes of it', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'a', fromMe: true, text: 'secret', timestamp: 1, status: 'sent' });
    await saveMessage(PEER, k, {
      id: 'b', fromMe: false, text: 'what?', timestamp: 2, status: 'delivered',
      replyTo: { id: 'a', from: 'You', text: 'secret' },
    });
    await setStoredReaction(PEER, k, 'a', 'them', '😮');
    const result = await deleteStoredMessage(PEER, k, 'a', true, 10, 'op-del');
    assert.equal(result.ok, true);
    const [a, b] = (await getConversation(PEER, k))!.messages;
    assert.equal(a.text, '');
    assert.equal(a.deletedAt, 10);
    assert.equal(a.reactions, undefined);
    assert.deepEqual(a.unsynced, { del: 'op-del' });
    assert.deepEqual(b.replyTo, { id: 'a', from: 'You', text: '' });
  });

  test('a peer can only delete their own messages', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'mine', fromMe: true, text: 'keep', timestamp: 1, status: 'sent' });
    assert.equal((await deleteStoredMessage(PEER, k, 'mine', false, 5)).ok, false);
    assert.equal((await deleteStoredMessage(PEER, k, 'nope', false, 5)).ok, false);
    assert.equal((await getConversation(PEER, k))!.messages[0].text, 'keep');
  });

  test('a deleted message cannot be edited, reacted to or resurrected by a re-save', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'x', fromMe: false, text: 'oops', timestamp: 1, status: 'delivered' });
    await deleteStoredMessage(PEER, k, 'x', false, 5);
    assert.equal(await editStoredMessage(PEER, k, 'x', 'again', 9, false), false);
    assert.equal(await setStoredReaction(PEER, k, 'x', 'me', '👍'), false);
    await saveMessage(PEER, k, { id: 'x', fromMe: false, text: 'oops', timestamp: 1, status: 'read' });
    const m = (await getConversation(PEER, k))!.messages[0];
    assert.equal(m.text, '');
    assert.equal(m.status, 'read');
  });

  test('delete for me removes only the local copy', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'x', fromMe: false, text: 'bye', timestamp: 1, status: 'delivered' });
    assert.equal((await removeStoredMessage(PEER, 'x')).ok, true);
    assert.equal((await getConversation(PEER, k))!.messages.length, 0);
  });
});

describe('unsynced changes', () => {
  test('are cleared by the peer acknowledging the control message', async () => {
    const k = await key();
    await saveMessage(PEER, k, { id: 'm', fromMe: true, text: 'v1', timestamp: 1, status: 'delivered' });
    await editStoredMessage(PEER, k, 'm', 'v2', 5, true, 'op-edit');
    await setStoredReaction(PEER, k, 'm', 'me', '👍', 'op-react');
    assert.deepEqual((await getConversation(PEER, k))!.messages[0].unsynced, { edit: 'op-edit', react: 'op-react' });
    assert.equal(await markOpSynced(PEER, 'op-edit'), 'm');
    assert.deepEqual((await getConversation(PEER, k))!.messages[0].unsynced, { react: 'op-react' });
    assert.equal(await markOpSynced(PEER, 'op-react'), 'm');
    assert.equal((await getConversation(PEER, k))!.messages[0].unsynced, undefined);
    assert.equal(await markOpSynced(PEER, 'unknown'), null);
  });
});

async function makeIdentity(): Promise<UnlockedIdentity> {
  const sodium = await getSodium();
  const kp = sodium.crypto_sign_keypair();
  return { publicKeyHex: sodium.to_hex(kp.publicKey), publicKey: kp.publicKey, privateKey: kp.privateKey, derivedKey: sodium.randombytes_buf(32) };
}

async function row(group: Group, identity: UnlockedIdentity, id: string, from: string, plaintext: string, timestamp: number) {
  const { ciphertext, nonce } = await encryptGroupMessage(plaintext, group, identity);
  return { id, groupId: group.id, fromPubKeyHex: from, ciphertext, nonce, timestamp, keyGeneration: group.keyGeneration, expiresAt: 0 };
}

describe('group delete for everyone', () => {
  test('tombstones the target and drops the rows that carry its content', async () => {
    const me = await makeIdentity();
    const self: GroupMember = { publicKeyHex: me.publicKeyHex, circuitAddr: '', joinedAt: 1 };
    const group = await createGroup('G', [self], me);
    const alice = 'a'.repeat(64);
    await saveGroupMessage(await row(group, me, 't', alice, 'secret plan', 1));
    await saveGroupMessage(await row(group, me, 'e', alice, encodeContent('secret plan v2', undefined, { edit: { id: 't' } }), 2));
    await saveGroupMessage(await row(group, me, 'r', me.publicKeyHex, encodeContent('', undefined, { react: { id: 't', emoji: '👍' } }), 3));
    await saveGroupMessage(await row(group, me, 'q', me.publicKeyHex, encodeContent('ok', { id: 't', from: 'Alice', text: 'secret plan' }), 4));

    // Someone else can't delete Alice's message.
    assert.equal((await purgeGroupMessage(group, me, 't', 'c'.repeat(64), 9)).ok, false);
    assert.equal((await purgeGroupMessage(group, me, 't', alice, 9)).ok, true);

    const rows = await getGroupMessages(group.id);
    assert.deepEqual(rows.map(r => r.id), ['t', 'q']);
    assert.equal(rows[0].deletedAt, 9);
    assert.equal(rows[0].ciphertext.length, 0);
    const quote = decodeContent(await decryptGroupMessage(rows[1].ciphertext, rows[1].nonce, group, me));
    assert.equal(quote.text, 'ok');
    assert.deepEqual(quote.replyTo, { id: 't', from: 'Alice', text: '' });
  });

  test('a deletion that arrives first turns the late message into a tombstone', async () => {
    const me = await makeIdentity();
    const group = await createGroup('G', [{ publicKeyHex: me.publicKeyHex, circuitAddr: '', joinedAt: 1 }], me);
    const bob = 'd'.repeat(64);
    assert.equal((await purgeGroupMessage(group, me, 'late', bob, 5)).ok, false);
    await saveGroupMessage(await row(group, me, 'late', bob, 'should never be stored', 1));
    // …but only for that author: another member reusing the id is unaffected.
    await saveGroupMessage(await row(group, me, 'other', 'e'.repeat(64), 'fine', 2));
    const rows = await getGroupMessages(group.id);
    assert.equal(rows.find(r => r.id === 'late')!.ciphertext.length, 0);
    assert.ok(rows.find(r => r.id === 'late')!.deletedAt);
    assert.equal(rows.find(r => r.id === 'other')!.deletedAt, undefined);
  });
});
