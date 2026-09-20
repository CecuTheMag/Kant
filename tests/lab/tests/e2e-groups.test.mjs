import assert from 'node:assert/strict';
import test from 'node:test';
import sodiumModule from 'libsodium-wrappers-sumo';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import {
  createGroup,
  saveGroup,
  getGroup,
  distributeGroupKey,
  rotateGroupKey,
  sendGroupMessage,
  handleIncomingGroupKey,
  decryptGroupMessage,
  buildPublicBundle,
  buildPrivateBundle,
} from '../../../packages/core/dist/index.js';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const sodium = sodiumModule.default ?? sodiumModule;
await sodium.ready;

async function reset() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('kant');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

/** Minimal UnlockedIdentity backed by a real Ed25519 keypair. */
async function makeIdentity() {
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicKeyHex: sodium.to_hex(kp.publicKey),
    derivedKey: sodium.randombytes_buf(32),
  };
}

/** A valid relay-style circuit multiaddr for a member with no live node. */
async function circuitAddr() {
  const relay = await generateKeyPairFromSeed('Ed25519', sodium.randombytes_buf(32));
  const peer = await generateKeyPairFromSeed('Ed25519', sodium.randombytes_buf(32));
  const relayId = peerIdFromPrivateKey(relay).toString();
  const peerId = peerIdFromPrivateKey(peer).toString();
  return `/ip4/127.0.0.1/tcp/3001/ws/p2p/${relayId}/p2p-circuit/p2p/${peerId}`;
}

function member(id, nickname, addr) {
  return { publicKeyHex: id.publicKeyHex, nickname, circuitAddr: addr, joinedAt: Date.now() };
}

/**
 * A minimal transport double that captures every length-prefixed frame it is
 * asked to send, so the real key-distribution and broadcast code paths run
 * without a relay. Only the dial hop is stubbed.
 */
function captureTransport(records) {
  return {
    getMultiaddrs: () => [],
    dial: async addr => {
      const entry = { addr: addr.toString(), framed: null };
      records.push(entry);
      return {
        newStream: async () => {
          const listeners = new Map();
          return {
            send: bytes => {
              entry.framed = bytes;
              const payload = decodeFramed(bytes);
              const ackBody = new TextEncoder().encode(JSON.stringify({
                type: 'group-key-ack', deliveryId: payload.deliveryId, status: 'accepted',
              }));
              const ack = new Uint8Array(4 + ackBody.length);
              new DataView(ack.buffer).setUint32(0, ackBody.length, false);
              ack.set(ackBody, 4);
              setTimeout(() => {
                for (const listener of listeners.get('message') ?? []) listener({ data: ack });
              }, 0);
            },
            addEventListener: (type, listener) => {
              const values = listeners.get(type) ?? [];
              values.push(listener);
              listeners.set(type, values);
            },
            close: async () => {},
          };
        },
      };
    },
  };
}

function decodeFramed(framed) {
  return JSON.parse(new TextDecoder().decode(framed.subarray(4)));
}

/** Re-derive the plaintext group key from a group object's at-rest fields. */
function groupKey(group, identity) {
  const encKey = sodium.crypto_kdf_derive_from_key(32, 2, 'kantgrpk', identity.derivedKey);
  return sodium.crypto_secretbox_open_easy(group.encryptedKey, group.keyNonce, encKey);
}

/** Simulate a member receiving a group-msg wire payload and decrypting it. */
async function receiveGroupMessage(wireJson, group, identity) {
  const payload = JSON.parse(wireJson);
  return decryptGroupMessage(
    new Uint8Array(Object.values(payload.ciphertext)),
    new Uint8Array(Object.values(payload.nonce)),
    group,
    identity
  );
}

test('group key rotates after a member is removed and the removed member cannot decrypt post-rotation traffic', async () => {
  await reset();

  const alice = await makeIdentity();
  const bob = await makeIdentity();
  const carol = await makeIdentity();

  const bobAddr = await circuitAddr();
  const carolAddr = await circuitAddr();
  const aliceMember = member(alice, 'Alice', '');
  const bobMember = member(bob, 'Bob', bobAddr);
  const carolMember = member(carol, 'Carol', carolAddr);

  // 1. Create a three-member group (creator included, as the app does).
  const group = await createGroup('three members', [aliceMember, bobMember, carolMember], alice);
  assert.equal(group.members.length, 3);
  assert.equal(group.keyGeneration, 0);

  // 2. Distribute the initial group key to the other two members.
  const bobPub = await buildPublicBundle(bob);
  const carolPub = await buildPublicBundle(carol);
  const bobPriv = await buildPrivateBundle(bob);
  const carolPriv = await buildPrivateBundle(carol);

  const keyRecords = [];
  const { sent, failed } = await distributeGroupKey(
    captureTransport(keyRecords), group, alice,
    new Map([[bob.publicKeyHex, bobPub], [carol.publicKeyHex, carolPub]])
  );
  assert.deepEqual([...failed], []);
  assert.deepEqual([...sent].sort(), [bob.publicKeyHex, carol.publicKeyHex].sort());

  const bobGroup = await handleIncomingGroupKey(
    decodeFramed(keyRecords.find(r => r.addr === bobAddr).framed), bob, bobPriv);
  const carolGroup = await handleIncomingGroupKey(
    decodeFramed(keyRecords.find(r => r.addr === carolAddr).framed), carol, carolPriv);
  assert.equal(bobGroup.keyGeneration, 0);
  assert.equal(carolGroup.keyGeneration, 0);

  // 3. Send a message before rotation — both members decrypt it.
  const outbound = [];
  const pingFn = async (_node, addr, wire) => { outbound.push({ addr, wire }); };
  await sendGroupMessage(captureTransport([]), group, 'before-rotation', alice, pingFn);

  assert.equal(await receiveGroupMessage(outbound.find(m => m.addr === bobAddr).wire, bobGroup, bob), 'before-rotation');
  assert.equal(await receiveGroupMessage(outbound.find(m => m.addr === carolAddr).wire, carolGroup, carol), 'before-rotation');

  // 4. Remove Carol (mirrors useGroups.removeMember) and rotate the key.
  const updated = {
    ...group,
    members: group.members.filter(m => m.publicKeyHex !== carol.publicKeyHex),
  };
  assert.equal(updated.members.length, 2);
  await saveGroup(updated);

  const rotatedRecords = [];
  const rotated = await rotateGroupKey(
    captureTransport(rotatedRecords), updated, alice,
    new Map([[bob.publicKeyHex, bobPub]])
  );

  // 5. Rotation verified: generation bumped, key material changed, persisted,
  //    and the new key is distributed only to the remaining member.
  assert.equal(rotated.keyGeneration, group.keyGeneration + 1);
  assert.deepEqual(rotated.members.map(m => m.publicKeyHex), [alice.publicKeyHex, bob.publicKeyHex]);
  assert.notDeepEqual([...groupKey(group, alice)], [...groupKey(rotated, alice)]);
  assert.equal((await getGroup(group.id)).keyGeneration, 1, 'rotated key persisted');
  assert.equal(rotatedRecords.length, 1, 'only the remaining member receives the rotated key');
  assert.equal(rotatedRecords[0].addr, bobAddr);

  const bobRotated = await handleIncomingGroupKey(decodeFramed(rotatedRecords[0].framed), bob, bobPriv);
  assert.equal(bobRotated.keyGeneration, 1);
  assert.equal(bobRotated.members.length, 2);

  // 6. Post-rotation message: Bob decrypts, Carol (stale pre-rotation key) cannot.
  const outboundAfter = [];
  const pingFnAfter = async (_node, addr, wire) => { outboundAfter.push({ addr, wire }); };
  await sendGroupMessage(captureTransport([]), rotated, 'after-rotation', alice, pingFnAfter);

  assert.deepEqual(outboundAfter.map(m => m.addr), [bobAddr], 'removed member is no longer a send target');
  const afterPayload = JSON.parse(outboundAfter[0].wire);
  assert.equal(await receiveGroupMessage(outboundAfter[0].wire, bobRotated, bob), 'after-rotation');
  await assert.rejects(
    () => decryptGroupMessage(
      new Uint8Array(Object.values(afterPayload.ciphertext)),
      new Uint8Array(Object.values(afterPayload.nonce)),
      carolGroup,
      carol
    ),
    undefined,
    'removed member must not decrypt post-rotation traffic'
  );
});
