import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import 'fake-indexeddb/auto';
import { getSodium } from './sodium.js';
import {
  RATCHET_LIMITS, initReceiverRatchet, initSenderRatchet, ratchetDecrypt, ratchetEncrypt,
  generateX25519Keypair,
} from './ratchet.js';
import type { EncryptedMessage, RatchetState } from './ratchet.js';
import { loadRatchets, saveRatchet } from './ratchetStore.js';
import { DB_NAME } from './db.js';

async function pair(): Promise<{ alice: RatchetState; bob: RatchetState }> {
  const sodium = await getSodium();
  const shared = sodium.randombytes_buf(32);
  const bobSpk = await generateX25519Keypair();
  return { alice: await initSenderRatchet(shared, bobSpk.publicKey), bob: await initReceiverRatchet(shared, bobSpk) };
}

async function sendMany(from: RatchetState, n: number, tag: string): Promise<EncryptedMessage[]> {
  const out: EncryptedMessage[] = [];
  for (let i = 0; i < n; i++) out.push(await ratchetEncrypt(from, `${tag}${i}`));
  return out;
}

/** Deep snapshot of everything that matters for "state untouched" assertions. */
function fingerprint(s: RatchetState): string {
  const h = (b: Uint8Array) => Buffer.from(b).toString('hex');
  return JSON.stringify({
    rk: h(s.rootKey), ck: h(s.receivingChainKey), sk: h(s.sendingChainKey), dhr: h(s.receivingRatchetPublic),
    ns: s.sendingNumber, nr: s.receivingNumber, pn: s.previousSendingNumber, cc: s.chainCounters,
    skipped: [...(s.skipped ?? new Map()).keys()],
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = () => resolve(); r.onerror = () => resolve(); });
});

describe('double ratchet ordering', () => {
  test('in-order conversation with several DH steps', async () => {
    const { alice, bob } = await pair();
    for (let round = 0; round < 4; round++) {
      for (const m of await sendMany(alice, 3, `a${round}-`)) assert.match(await ratchetDecrypt(bob, m), /^a\d-\d$/);
      for (const m of await sendMany(bob, 2, `b${round}-`)) assert.match(await ratchetDecrypt(alice, m), /^b\d-\d$/);
    }
    assert.equal(bob.skipped?.size, 0);
  });

  test('reordered delivery within one chain decrypts every message exactly once', async () => {
    const { alice, bob } = await pair();
    const msgs = await sendMany(alice, 6, 'm');
    const order = [2, 3, 4, 0, 5, 1]; // the order observed on a real phone
    for (const i of order) assert.equal(await ratchetDecrypt(bob, msgs[i]), `m${i}`);
    assert.equal(bob.skipped?.size, 0, 'every skipped key was consumed');
  });

  test('messages from the previous chain still decrypt after the peer ratcheted (prevChainLen)', async () => {
    const { alice, bob } = await pair();
    const first = await sendMany(alice, 3, 'old');
    assert.equal(await ratchetDecrypt(bob, first[0]), 'old0');
    // Bob replies → Alice ratchets → Alice's next chain starts.
    assert.equal(await ratchetDecrypt(alice, await ratchetEncrypt(bob, 'reply')), 'reply');
    const second = await sendMany(alice, 2, 'new');
    assert.equal(second[0].header.prevChainLen, 3);
    // New-chain messages arrive before the delayed tail of the old chain.
    assert.equal(await ratchetDecrypt(bob, second[1]), 'new1');
    assert.equal(await ratchetDecrypt(bob, first[2]), 'old2');
    assert.equal(await ratchetDecrypt(bob, second[0]), 'new0');
    assert.equal(await ratchetDecrypt(bob, first[1]), 'old1');
    assert.equal(bob.skipped?.size, 0);
  });

  test('a replayed message is refused and the state is unchanged', async () => {
    const { alice, bob } = await pair();
    const [m0, m1] = await sendMany(alice, 2, 'x');
    await ratchetDecrypt(bob, m1);
    await ratchetDecrypt(bob, m0);
    const before = fingerprint(bob);
    await assert.rejects(ratchetDecrypt(bob, m0));
    await assert.rejects(ratchetDecrypt(bob, m1));
    assert.equal(fingerprint(bob), before);
  });

  test('a jump beyond MAX_SKIP is refused without touching the state', async () => {
    const { alice, bob } = await pair();
    const [m] = await sendMany(alice, 1, 'x');
    const forged: EncryptedMessage = { ...m, header: { ...m.header, msgNum: RATCHET_LIMITS.maxSkip + 5 } };
    const before = fingerprint(bob);
    await assert.rejects(ratchetDecrypt(bob, forged), /refusing to skip/);
    assert.equal(fingerprint(bob), before);
    assert.equal(await ratchetDecrypt(bob, m), 'x0', 'the genuine message still decrypts');
  });

  test('a failed attempt with the wrong session leaves that session untouched', async () => {
    const a = await pair();
    const b = await pair();
    const msgs = await sendMany(a.alice, 3, 'z');
    await ratchetDecrypt(b.bob, (await sendMany(b.alice, 1, 'warm'))[0]);
    const before = fingerprint(b.bob);
    await assert.rejects(ratchetDecrypt(b.bob, msgs[2]));
    assert.equal(fingerprint(b.bob), before, 'the "try every ratchet" loop cannot corrupt other sessions');
    assert.equal(await ratchetDecrypt(a.bob, msgs[2]), 'z2');
  });

  test('a tampered header or ciphertext never commits skipped keys', async () => {
    const { alice, bob } = await pair();
    const msgs = await sendMany(alice, 3, 't');
    const bad: EncryptedMessage = { ...msgs[2], ciphertext: msgs[2].ciphertext.map((x, i) => (i === 0 ? x ^ 1 : x)) };
    const before = fingerprint(bob);
    await assert.rejects(ratchetDecrypt(bob, bad));
    assert.equal(fingerprint(bob), before);
  });

  test('the skipped-key store is bounded', async () => {
    const { alice, bob } = await pair();
    const burst = await sendMany(alice, RATCHET_LIMITS.maxSkip + 1, 'b');
    await ratchetDecrypt(bob, burst[RATCHET_LIMITS.maxSkip]);
    assert.equal(bob.skipped?.size, RATCHET_LIMITS.maxSkip);
    assert.ok(bob.skipped!.size <= RATCHET_LIMITS.maxStoredSkipped);
  });

  test('a legacy session (global counter, no chainCounters) keeps decrypting sequentially, then upgrades', async () => {
    const { alice, bob } = await pair();
    await ratchetDecrypt(bob, (await sendMany(alice, 1, 'warm'))[0]);
    // Simulate a record written by an older build mid-chain: global counter, no new fields.
    bob.chainCounters = undefined;
    bob.receivingNumber = 57;
    bob.skipped = undefined;
    bob.previousSendingNumber = undefined;
    // Alice continues on the same chain: the legacy session decrypts them in order, as before.
    const same = await sendMany(alice, 2, 'seq');
    assert.equal(await ratchetDecrypt(bob, same[0]), 'seq0');
    assert.equal(await ratchetDecrypt(bob, same[1]), 'seq1');
    assert.equal(bob.chainCounters, undefined, 'still legacy until the next DH step');
    // Bob replies, Alice ratchets: her next chain upgrades Bob to per-chain counters,
    // and from then on reordering is tolerated.
    await ratchetDecrypt(alice, await ratchetEncrypt(bob, 'r'));
    const after = await sendMany(alice, 3, 'up');
    assert.equal(await ratchetDecrypt(bob, after[2]), 'up2');
    assert.equal(bob.chainCounters, true);
    assert.equal(await ratchetDecrypt(bob, after[0]), 'up0');
    assert.equal(await ratchetDecrypt(bob, after[1]), 'up1');
  });

  test('skipped keys and counters survive persistence', async () => {
    const sodium = await getSodium();
    const derivedKey = sodium.randombytes_buf(32);
    const { alice, bob } = await pair();
    const msgs = await sendMany(alice, 4, 'p');
    await ratchetDecrypt(bob, msgs[3]);
    await saveRatchet('bob', derivedKey, bob);
    const restored = (await loadRatchets(derivedKey)).get('bob')!;
    assert.equal(restored.chainCounters, true);
    assert.equal(restored.skipped?.size, 3);
    for (const i of [1, 0, 2]) assert.equal(await ratchetDecrypt(restored, msgs[i]), `p${i}`);
  });
});
