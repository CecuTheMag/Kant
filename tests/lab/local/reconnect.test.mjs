/**
 * Two real Kant web clients, each on its OWN relay, the relays not federated —
 * and devices switched off and on in every awkward order. Nothing is mocked:
 * real relay processes, the built app, persistent browser profiles (a closed
 * profile is a switched-off phone: its identity, contacts and sessions stay on
 * disk, its network presence is gone).
 *
 *     Alice ──▶ relay A            relay B ◀── Bob        (relay C: Bob moves there)
 *
 * The bug this guards against: whoever came online while the other was off
 * dropped the other's address, and with unfederated relays nothing could find
 * it again — the two had to re-send invite links. Every scenario here ends
 * with both directions of a conversation working and no link re-sent.
 *
 * Run:  pnpm run test:reconnect      (builds relay + app, then runs this file)
 * Federated relays instead:  KANT_FEDERATE=1 pnpm run test:reconnect
 * Watch it:  HEADED=1 pnpm run test:reconnect
 * Against another build:  KANT_APP_DIST=/path/to/app/dist node --test tests/lab/local/reconnect.test.mjs
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { defineRelay, startRelay, stopRelay, serveApp, defineDevice, sleep, cleanup, federate, waitFederated, PORT_BASE } from './harness.mjs';

// KANT_FEDERATE=1: relays A, B and C federate with each other (RELAY_FEDERATION),
// the other common setup between two people who each run a relay.
const FEDERATED = process.env.KANT_FEDERATE === '1';

// Long enough for an online device to try (and fail) to reach the other one:
// the directory refresh runs every 20 s and presence goes out every 60 s.
const ALONE_MS = Number(process.env.KANT_ALONE_MS ?? 80_000);
const DELIVERY_MS = 180_000;

const relays = { A: defineRelay('a', PORT_BASE), B: defineRelay('b', PORT_BASE + 10), C: defineRelay('c', PORT_BASE + 20) };
const all = Object.values(relays);
const alice = defineDevice('Alice', all);
const bob = defineDevice('Bob', all);
let app;
let n = 0;

async function publicKey(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('kant');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const get = req.result.transaction('identity', 'readonly').objectStore('identity').get('keypair');
      get.onsuccess = () => resolve(get.result?.publicKeyHex ?? '');
      get.onerror = () => reject(get.error);
    };
  }));
}

/** The link "Copy link" in My code produces (ui/lib.ts buildInvite). */
function inviteLink(hex, name, relay) {
  const p = new URLSearchParams({ k: hex, n: name, r: relay.url });
  return `https://kant.network/add#${p}`;
}

async function addByLink(page, link) {
  await page.getByRole('button', { name: 'Add a contact' }).click();
  await page.locator('#invite').fill(link);
  await page.getByRole('button', { name: 'Add contact', exact: true }).last().click();
}

async function openChat(page, name) {
  await page.locator('.k-row-name', { hasText: name }).first().click();
  await page.getByLabel('Message', { exact: true }).waitFor({ timeout: 30_000 });
}

async function send(device, text) {
  await device.page.getByLabel('Message', { exact: true }).fill(text);
  // The button enables once the app is connected to its relay.
  await device.page.getByRole('button', { name: 'Send', exact: true }).click({ timeout: 120_000 });
  await device.page.locator('.k-msg.out', { hasText: text }).first().waitFor({ timeout: 10_000 });
}

async function expectReceived(device, text) {
  try {
    await device.page.locator('.k-msg.in', { hasText: text }).first().waitFor({ timeout: DELIVERY_MS });
  } catch {
    const tail = (d) => d.log.filter((l) => !/💓|kant-cover|getRelayInfo/.test(l)).slice(-60).join('\n');
    throw new Error(`${device.name} never received "${text}"\n--- Alice log ---\n${tail(alice)}\n--- Bob log ---\n${tail(bob)}`);
  }
}

/** Both directions work: the real test of "we can still chat". */
async function assertConversation(label) {
  const a2b = `${label} · Alice→Bob #${++n}`;
  const b2a = `${label} · Bob→Alice #${++n}`;
  await openChat(alice.page, 'Bob');
  await openChat(bob.page, 'Alice');
  await send(alice, a2b);
  await send(bob, b2a);
  await Promise.all([expectReceived(bob, a2b), expectReceived(alice, b2a)]);
}

/** Switch a device to another relay, as Settings → Network does, then restart the app. */
async function moveRelay(device, relay) {
  await device.page.evaluate((url) => localStorage.setItem('kant_relay_url', url), relay.url);
  await device.off();
  await device.on(app.url);
}

describe(`two devices on two ${FEDERATED ? 'federated' : 'unfederated'} relays, switched off and on`, { timeout: 60 * 60_000 }, () => {
  before(async () => {
    if (FEDERATED) await federate(all);
    for (const r of all) await startRelay(r);
    if (FEDERATED) await waitFederated(all);
    app = await serveApp(PORT_BASE + 90);
    await Promise.all([alice.on(app.url, relays.A), bob.on(app.url, relays.B)]);
    const [aliceKey, bobKey] = await Promise.all([publicKey(alice.page), publicKey(bob.page)]);
    assert.match(aliceKey, /^[0-9a-f]{64}$/);
    assert.match(bobKey, /^[0-9a-f]{64}$/);
    // The one and only time links are exchanged.
    await addByLink(alice.page, inviteLink(bobKey, 'Bob', relays.B));
    await addByLink(bob.page, inviteLink(aliceKey, 'Alice', relays.A));
  });

  after(async () => {
    await alice.off();
    await bob.off();
    await app?.close();
    for (const r of all) await stopRelay(r);
    cleanup();
  });

  test('first contact across the two relays', async () => {
    await assertConversation('first contact');
  });

  test('both off; Alice back alone, off; Bob back alone, off; then both back on', async () => {
    // This order is what wiped both saved addresses before the fix.
    await Promise.all([alice.off(), bob.off()]);
    await alice.on(app.url);
    await sleep(ALONE_MS);
    await alice.off();
    await bob.on(app.url);
    await sleep(ALONE_MS);
    await bob.off();
    await alice.on(app.url);
    await bob.on(app.url);
    await assertConversation('after staggered restarts');
  });

  test('a message written while the other is off arrives after both restart', async () => {
    await bob.off();
    const queued = `written while Bob was off #${++n}`;
    await openChat(alice.page, 'Bob');
    await send(alice, queued);
    await sleep(5_000);
    await alice.off();
    await bob.on(app.url);
    await sleep(ALONE_MS / 2);
    await alice.on(app.url);
    await openChat(bob.page, 'Alice');
    await expectReceived(bob, queued);
    await assertConversation('after queued delivery');
  });

  test('everything off — both devices and both relays — then back on', async () => {
    await Promise.all([alice.off(), bob.off()]);
    await stopRelay(relays.A);
    await stopRelay(relays.B);
    await sleep(5_000);
    await startRelay(relays.A);
    await startRelay(relays.B);
    if (FEDERATED) await waitFederated(all);
    await Promise.all([bob.on(app.url), alice.on(app.url)]);
    await assertConversation('after full power cycle');
  });

  test('Bob moves to another relay while Alice is off, then both restart', async () => {
    await alice.off();
    await moveRelay(bob, relays.C);
    await sleep(ALONE_MS);
    await bob.off();
    await alice.on(app.url);
    await sleep(ALONE_MS);
    await bob.on(app.url);
    await assertConversation('after Bob changed relay');
  });
});
