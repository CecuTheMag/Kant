/**
 * Smoke test for two live, federated relays: a client homed on each relay
 * exchanges messages both ways and sends a file across the federation tunnel.
 * Pass the same URL twice to test one relay (e.g. a max-size file through it).
 *
 * Build core first (`pnpm run build`), then from packages/core:
 *   node --loader ./sodium-loader.mjs --import ./sodium-loader.mjs scripts/federation-smoke.mjs \
 *     https://relay-a.example.org http://relay-b.lan:3001 [fileMiB]
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const [urlA, urlB, fileMiB = '5'] = process.argv.slice(2);
if (!urlA || !urlB) { console.error('usage: federation-smoke.mjs <relayA-url> <relayB-url> [fileMiB]'); process.exit(2); }
const say = console.log;
console.log = () => {}; console.warn = () => {}; console.debug = () => {};
const core = await import('../dist/index.js');
const files = await import('../dist/files.js');
const { default: sodium } = await import('libsodium-wrappers-sumo');
await sodium.ready;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(200); }
}

async function client(url) {
  const info = await core.getRelayInfo(undefined, url);
  const kp = sodium.crypto_sign_keypair();
  const id = { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyHex: sodium.to_hex(kp.publicKey) };
  const inbox = [];
  const node = await core.createNode((from, msg) => inbox.push(msg), undefined, info.multiaddr, id);
  core.configureFederation(node, info.multiaddr, info.federation);
  const circuit = await waitFor('reservation', () => node.getMultiaddrs().map(String).find((a) => a.includes('/p2p-circuit') && a.includes(info.peerId)));
  await core.registerWithRelay(0, id.publicKeyHex, circuit, node.peerId.toString(), id.privateKey, url);
  return { id, node, inbox, circuit, url, info };
}

const t0 = Date.now();
const a = await client(urlA);
const b = await client(urlB);
say(`A ${a.info.peerId.slice(0, 16)}… federates with ${JSON.stringify(a.info.federation?.peers ?? [])}`);
if (a.info.peerId !== b.info.peerId) assert.ok(a.info.federation?.peers?.includes(b.info.peerId), 'relay A lists relay B as a federation peer');

const bFromA = await waitFor('A finds B via federated lookup', async () => (await core.lookupPeers(0, [b.id.publicKeyHex], urlA, a.id))[b.id.publicKeyHex]);
assert.equal(bFromA, b.circuit);
const aFromB = await waitFor('B finds A via federated lookup', async () => (await core.lookupPeers(0, [a.id.publicKeyHex], urlB, b.id))[a.id.publicKeyHex]);
assert.equal(aFromB, a.circuit);
say('✔ federated lookup both ways');

for (let i = 0; i < 20; i++) await core.sendPing(a.node, bFromA, `a2b ${i}`);
for (let i = 0; i < 20; i++) await core.sendPing(b.node, aFromB, `b2a ${i}`);
await waitFor('40 messages', () => b.inbox.filter((m) => m.startsWith('a2b')).length === 20 && a.inbox.filter((m) => m.startsWith('b2a')).length === 20);
assert.deepEqual(b.inbox.filter((m) => m.startsWith('a2b')), Array.from({ length: 20 }, (_, i) => `a2b ${i}`), 'in order');
say('✔ 20 messages each way, in order');

const bX = await core.ed25519ToX25519(b.id.publicKey, b.id.privateKey);
let received;
await files.registerFileHandler(b.node, {
  onMeta: async () => 'accept', onChunk: async () => {}, onProgress: () => {},
  onComplete: async (_id, verified, data) => { assert.equal(verified, true); received = data; },
  onError: (e) => say('file error', e),
}, { recipientX25519: bX });
const source = new Uint8Array(randomBytes(Number(fileMiB) * 1024 * 1024));
const tf = Date.now();
await files.sendFile(a.node, { peerCircuitAddr: bFromA, fileData: source, fileName: 'smoke.bin', mimeType: 'application/octet-stream', recipientX25519Pub: bX.publicKey });
await waitFor('file', () => received, 180_000);
const secs = (Date.now() - tf) / 1000;
assert.equal(createHash('sha256').update(received).digest('hex'), createHash('sha256').update(source).digest('hex'));
say(`✔ ${fileMiB} MiB file A→B intact in ${secs.toFixed(1)}s (${(Number(fileMiB) * 8 / secs).toFixed(1)} Mbit/s)`);

await a.node.stop(); await b.node.stop();
say(`PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
