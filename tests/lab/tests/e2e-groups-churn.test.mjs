import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserPair, createClient, createGroupUI, waitForContactOnline,
  addContact, openChat, sendText, incoming, unlock, chatRow,
} from './e2e-browser-helpers.mjs';

const KANT_RELAY_LAB_CONTROL_TOKEN = process.env.KANT_RELAY_LAB_CONTROL_TOKEN ?? 'kant-lab-restart-token';
const relayBaseUrl = (process.env.KANT_RELAY_INFO_URL ?? 'http://localhost:3001/relay-info').replace(/\/relay-info$/, '');
const relayInfoUrl = process.env.KANT_RELAY_INFO_URL ?? 'http://localhost:3001/relay-info';

async function getIdentityKey(target) {
  const page = target?.page ?? target;
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('kant');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const get = r.result.transaction('identity', 'readonly').objectStore('identity').get('keypair');
      get.onsuccess = () => resolve(get.result?.publicKeyHex ?? '');
    };
  }));
}

async function waitForRelay(previousUptime = Number.POSITIVE_INFINITY, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let restartObserved = false;
  while (true) {
    try {
      const health = await fetch(`${relayBaseUrl}/healthz`);
      if (health.ok) {
        const body = await health.json().catch(() => ({}));
        const uptime = Number(body?.uptime);
        if (Number.isFinite(uptime) && uptime < previousUptime) restartObserved = true;
        if (restartObserved && (await fetch(relayInfoUrl)).ok) return;
      } else {
        restartObserved = true;
      }
    } catch {
      restartObserved = true;
    }
    if (Date.now() >= deadline) throw new Error('relay did not restart in time');
    await new Promise(r => setTimeout(r, 250));
  }
}

async function waitForReservations(peerIds, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${relayBaseUrl}/admin/reservations`, {
        headers: { authorization: `Bearer ${KANT_RELAY_LAB_CONTROL_TOKEN}` },
      });
      if (res.ok) {
        const body = await res.json();
        const active = new Set((body?.reservations ?? []).map(r => r.peerId));
        if (peerIds.every(peerId => active.has(peerId))) return;
      }
    } catch { /* relay still restarting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`relay did not recover reservations for: ${peerIds.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Relay restart during group key distribution
// ─────────────────────────────────────────────────────────────────────────────
test('group key delivery survives relay restart during distribution', { timeout: 420_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const { alice, bob } = pair;

    // Alice creates a group with Bob (already added as contact by createBrowserPair)
    await createGroupUI(alice.page, 'churn-restart-group', ['Bob E2E']);
    await chatRow(bob.page, 'churn-restart-group').waitFor({ timeout: 30_000 });
    await openChat(bob.page, 'churn-restart-group');

    const expectedPeerIds = await Promise.all([alice.page, bob.page].map(page =>
      page.evaluate(() => (window.__kantCircuitAddr ?? '').split('/p2p/').pop() ?? '')
    ));
    expectedPeerIds.forEach(peerId => assert.match(peerId, /^12D3KooW/, 'client peer id available'));

    // Restart the relay. Capture uptime first so waitForRelay cannot mistake
    // the still-running pre-exit process (the endpoint exits 50ms after 202)
    // for the restarted instance.
    const beforeHealth = await fetch(`${relayBaseUrl}/healthz`).then(r => r.json());
    const previousUptime = Number(beforeHealth?.uptime);
    const res = await fetch(`${relayBaseUrl}/__lab/restart`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KANT_RELAY_LAB_CONTROL_TOKEN}` },
    });
    assert.equal(res.status, 202, 'Relay restart accepted');
    await waitForRelay(previousUptime);
    // The HTTP process can be healthy while peers are still reacquiring their
    // circuit reservations. Sending before both are present only tests a known
    // offline-recipient window, not post-restart delivery.
    await waitForReservations(expectedPeerIds);

    await openChat(alice.page, 'churn-restart-group');
    await sendText(alice.page, 'alice-after-restart');
    await incoming(bob.page, 'alice-after-restart').waitFor({ timeout: 90_000 });
  } finally {
    await pair.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Member disconnect and reconnect
// ─────────────────────────────────────────────────────────────────────────────
test('group key delivery survives member disconnect and reconnect', { timeout: 420_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const { alice, bob, browser } = pair;

    await createGroupUI(alice.page, 'churn-disconnect-group', ['Bob E2E']);
    await chatRow(bob.page, 'churn-disconnect-group').waitFor({ timeout: 30_000 });
    await openChat(bob.page, 'churn-disconnect-group');
    await openChat(alice.page, 'churn-disconnect-group');
    await sendText(alice.page, 'before-disconnect');
    await incoming(bob.page, 'before-disconnect').waitFor({ timeout: 90_000 });

    // Carol joins: she and Alice add each other by invite link.
    const carol = await createClient(browser, 'Carol');
    const carolKey = await getIdentityKey(carol.page);
    const aliceKey = await getIdentityKey(alice.page);
    await addContact(alice.page, carolKey, 'Carol E2E');
    await addContact(carol.page, aliceKey, 'Alice E2E');
    await Promise.all([
      waitForContactOnline(alice.page, 'Carol E2E', 120_000),
      waitForContactOnline(carol.page, 'Alice E2E', 120_000),
    ]);

    // Alice creates a 3-member group
    await createGroupUI(alice.page, 'churn-three-member', ['Bob E2E', 'Carol E2E']);
    for (const page of [bob.page, carol.page]) {
      await chatRow(page, 'churn-three-member').waitFor({ timeout: 30_000 });
    }
    await openChat(bob.page, 'churn-three-member');

    // Carol goes offline — reload locks her identity (node not started =
    // effectively offline, same as closing the app on a device).
    await carol.page.reload();

    await openChat(alice.page, 'churn-three-member');
    await sendText(alice.page, 'message-during-offline');
    await incoming(bob.page, 'message-during-offline').waitFor({ timeout: 90_000 });

    // Carol comes back: same identity, the group is still there, and the
    // message sent while she was away reaches her.
    await unlock(carol.page, 'Carol');
    await openChat(carol.page, 'churn-three-member');
    await incoming(carol.page, 'message-during-offline').waitFor({ timeout: 180_000 });
  } finally {
    await pair.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Concurrent member churn
// ─────────────────────────────────────────────────────────────────────────────
test('group key delivery survives concurrent member churn', { timeout: 420_000 }, async () => {
  const pair = await createBrowserPair();
  try {
    const { alice, bob } = pair;

    await createGroupUI(alice.page, 'churn-concurrent-group', ['Bob E2E']);
    await chatRow(bob.page, 'churn-concurrent-group').waitFor({ timeout: 30_000 });
    await openChat(bob.page, 'churn-concurrent-group');
    await openChat(alice.page, 'churn-concurrent-group');
    await sendText(alice.page, 'before-concurrent-churn');
    await incoming(bob.page, 'before-concurrent-churn').waitFor({ timeout: 90_000 });

    // Bob goes offline — reload locks his identity (node stops).
    await bob.page.reload();

    // Alice sends while Bob is offline
    await sendText(alice.page, 'msg-during-churn');

    // Bob comes back: the group persists and the missed message arrives.
    await unlock(bob.page, 'Bob');
    await openChat(bob.page, 'churn-concurrent-group');
    await incoming(bob.page, 'msg-during-churn').waitFor({ timeout: 180_000 });
  } finally {
    await pair.close();
  }
});
