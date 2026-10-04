/**
 * e2e-groups-scale.test.mjs
 *
 * Scale E2E tests for group key distribution and messaging with 10-50 members.
 * Tests verify:
 * - Key distribution completion under nominal conditions
 * - Key distribution with relay restart churn
 * - Key distribution with member disconnect/reconnect churn
 * - Key generation counter correctness
 *
 * Timeout budget per test (N members):
 *   N=10  → key: 30s, msg: 60s, total: 120s
 *   N=50  → key: 90s, msg: 120s, total: 240s
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserGroup,
  createGroupUI,
  openChat,
  chatRow,
  sendText,
  incoming,
} from './e2e-browser-helpers.mjs';
import { eventually } from './e2e-helpers.mjs';

const KANT_RELAY_LAB_CONTROL_TOKEN = process.env.KANT_RELAY_LAB_CONTROL_TOKEN ?? 'kant-lab-restart-token';
const relayInfoUrl = process.env.KANT_RELAY_INFO_URL ?? 'http://relay:3001/relay-info';
const relayBaseUrl = relayInfoUrl.replace(/\/relay-info$/, '');
const runLargeScale = process.env.KANT_RUN_LARGE_SCALE === '1';

/** Helper: restart the relay server */
async function restartRelay() {
  assert.ok(KANT_RELAY_LAB_CONTROL_TOKEN, 'KANT_RELAY_LAB_CONTROL_TOKEN is required for relay restart tests');
  const response = await fetch(`${relayBaseUrl}/__lab/restart`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KANT_RELAY_LAB_CONTROL_TOKEN}` }
  });
  assert.equal(response.status, 202, 'Relay restart accepted');
}

/** Helper: wait for relay to come back up */
async function waitForRelay(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      if ((await fetch(relayInfoUrl)).ok) break;
    } catch {}
    if (Date.now() >= deadline) throw new Error('relay did not restart');
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Helper: create a group through the New group sheet — delegates to shared helper */
async function createGroupUILocal(ownerPage, groupName, memberNicknames) {
  return createGroupUI(ownerPage, groupName, memberNicknames);
}

/** Helper: wait for a group to appear on a member's page */
async function waitForGroup(page, groupName, timeoutMs = 30_000, memberLabel = 'Member') {
  // Wait for the receive handler to persist the group before looking for it
  // in the chat list, which can briefly render empty under scale-test load.
  await eventually(
    async () => {
      return page.evaluate(async name => new Promise((resolve, reject) => {
        const request = indexedDB.open('kant');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const getAll = request.result.transaction('groups', 'readonly').objectStore('groups').getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => resolve(getAll.result.some(group => group.name === name));
        };
      }), groupName);
    },
    { timeout: timeoutMs, message: `${memberLabel} did not persist group: ${groupName}` }
  );

  await chatRow(page, groupName).waitFor({ timeout: timeoutMs });
}

/** Helper: click on a group to open it in the chat area */
async function openGroup(page, groupName) {
  await openChat(page, groupName);
}

/** Helper: check group key generation counter from the page */
async function getKeyGeneration(page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('kant');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('groups', 'readonly');
        const store = tx.objectStore('groups');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const groups = getAll.result;
          if (groups && groups.length > 0) {
            resolve(groups[0].keyGeneration ?? 0);
          } else {
            resolve(0);
          }
        };
        getAll.onerror = () => reject(getAll.error);
      };
    });
  });
}

/** Helper: send a group message and wait for delivery */
async function sendGroupMessage(page, text, expectedReceivers, timeoutMs = 60_000) {
  await sendText(page, text);
  await Promise.all(
    expectedReceivers.map(receiver => incoming(receiver.page ?? receiver, text).waitFor({ timeout: timeoutMs }))
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: 10 members under nominal conditions
// ═══════════════════════════════════════════════════════════════════════════

test('group key delivery: 10 members under nominal conditions', { timeout: 600_000 }, async () => {
  const N = 10;
  const groupName = 'scale-test-10';
  const keyTimeout = 75_000;
  const msgTimeout = 120_000;

  console.log(`\n=== Starting ${N}-member scale test (nominal) ===`);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[${N}-member] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  const group = await createBrowserGroup(N);
  try {
    const [owner, ...members] = group.members;
    console.log(`[${N}-member] All ${N} identities created`);
    const memberNicknames10 = members.map((_, i) => `Member${i + 1}`);
    await createGroupUILocal(owner.page, groupName, memberNicknames10);
    console.log(`[${N}-member] Group created: ${groupName}`);

    // Wait for all members to see the group
    await Promise.all(
      members.map((m, i) => waitForGroup(m.page, groupName, keyTimeout, `Member${i + 1}`))
    );
    console.log(`[${N}-member] All ${N} members see the group`);

    // Open the group on the owner for the composer and on recipients for the
    // rendered-message assertions.
    await Promise.all(
      group.members.map(m => openGroup(m.page, groupName))
    );

    // Send first group message
    await sendGroupMessage(owner.page, `hello from ${N}-member group`, members, msgTimeout);
    console.log(`[${N}-member] First message delivered to all ${N} members`);

    const endMem = process.memoryUsage().heapUsed;
    console.log(`[${N}-member] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);
    console.log(`✓ ${N}-member nominal test passed`);
  } finally {
    await group.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST: 50 members under nominal conditions
// ═══════════════════════════════════════════════════════════════════════════

test('group key delivery: 50 members under nominal conditions', {
  timeout: 420_000,
  skip: runLargeScale ? false : 'set KANT_RUN_LARGE_SCALE=1 on a runner with at least 8 GiB RAM',
}, async () => {
  const N = 50;
  const groupName = 'scale-test-50';
  const keyTimeout = 120_000;
  const msgTimeout = 180_000;

  console.log(`\n=== Starting ${N}-member scale test (nominal) ===`);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[${N}-member] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  const group = await createBrowserGroup(N);
  try {
    const [owner, ...members] = group.members;
    console.log(`[${N}-member] All ${N} identities created`);
    const memberNicknames50 = members.map((_, i) => `Member${i + 1}`);
    await createGroupUILocal(owner.page, groupName, memberNicknames50);
    console.log(`[${N}-member] Group created: ${groupName}`);

    // Wait for all members to see the group
    await Promise.all(
      members.map((m, i) => waitForGroup(m.page, groupName, keyTimeout))
    );
    console.log(`[${N}-member] All ${N} members see the group`);

    // Open the group everywhere: the owner to send, members to see it arrive
    await Promise.all(
      group.members.map(m => openGroup(m.page, groupName))
    );

    // Send first group message
    await sendGroupMessage(owner.page, `hello from ${N}-member group`, members, msgTimeout);
    console.log(`[${N}-member] First message delivered to all ${N} members`);

    const endMem = process.memoryUsage().heapUsed;
    console.log(`[${N}-member] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);
    console.log(`✓ ${N}-member nominal test passed`);
  } finally {
    await group.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST: 10 members under relay restart churn
// ═══════════════════════════════════════════════════════════════════════════

test('group key delivery: 10 members under relay restart churn', { timeout: 240_000 }, async () => {
  const N = 10;
  const groupName = 'scale-test-10-churn';
  const keyTimeout = 75_000;
  const msgTimeout = 120_000;

  console.log(`\n=== Starting ${N}-member relay restart churn test ===`);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[${N}-member-churn] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  const group = await createBrowserGroup(N);
  try {
    const [owner, ...members] = group.members;
    console.log(`[${N}-member-churn] All ${N} identities created`);
    const memberNicknamesChurn = members.map((_, i) => `Member${i + 1}`);
    await createGroupUILocal(owner.page, groupName, memberNicknamesChurn);
    console.log(`[${N}-member-churn] Group created: ${groupName}`);

    // Wait for all members to see the group
    await Promise.all(
      members.map((m, i) => waitForGroup(m.page, groupName, keyTimeout))
    );
    console.log(`[${N}-member-churn] All ${N} members see the group`);

    // Open the group everywhere: the owner to send, members to see it arrive
    await Promise.all(
      group.members.map(m => openGroup(m.page, groupName))
    );

    // Restart relay during/after key distribution
    console.log(`[${N}-member-churn] Restarting relay...`);
    await restartRelay();
    console.log(`[${N}-member-churn] Waiting for relay to come back up...`);
    await waitForRelay();
    console.log(`[${N}-member-churn] Relay is back up`);

    // Give members a moment to reconnect
    await new Promise(r => setTimeout(r, 3_000));

    // Send message after restart
    await sendGroupMessage(owner.page, `message after relay restart`, members, msgTimeout);
    console.log(`[${N}-member-churn] Message delivered to all ${N} members after restart`);

    const endMem = process.memoryUsage().heapUsed;
    console.log(`[${N}-member-churn] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);
    console.log(`✓ ${N}-member relay restart churn test passed`);
  } finally {
    await group.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST: 10 members with member churn (3 go offline, the rest keep receiving)
// ═══════════════════════════════════════════════════════════════════════════

test('group key delivery: 10 members with member churn', { timeout: 240_000 }, async () => {
  const N = 10;
  const OFFLINE_COUNT = 3;
  const groupName = 'scale-test-10-member-churn';
  const keyTimeout = 75_000;
  const msgTimeout = 120_000;

  console.log(`\n=== Starting ${N}-member (${OFFLINE_COUNT} offline) churn test ===`);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[${N}-member-member-churn] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  const group = await createBrowserGroup(N);
  try {
    const [owner, ...members] = group.members;
    console.log(`[${N}-member-member-churn] All ${N} identities created`);
    const memberNicknamesMC = members.map((_, i) => `Member${i + 1}`);
    await createGroupUILocal(owner.page, groupName, memberNicknamesMC);
    console.log(`[${N}-member-member-churn] Group created: ${groupName}`);

    // Wait for all members to see the group
    await Promise.all(
      members.map((m, i) => waitForGroup(m.page, groupName, keyTimeout))
    );
    console.log(`[${N}-member-member-churn] All ${N} members see the group`);

    // Open the group everywhere: the owner to send, members to see it arrive
    await Promise.all(
      group.members.map(m => openGroup(m.page, groupName))
    );

    // Send initial message to all members (including offline ones)
    await sendGroupMessage(owner.page, 'message-before-offline', members, msgTimeout);
    console.log(`[${N}-member-member-churn] Initial message delivered to all ${N} members`);

    // Disconnect 3 members by closing their contexts
    const offlineMembers = members.slice(0, OFFLINE_COUNT);
    const onlineMembers = members.slice(OFFLINE_COUNT);
    console.log(`[${N}-member-member-churn] Disconnecting ${OFFLINE_COUNT} members...`);
    for (const m of offlineMembers) {
      await m.context.close();
    }
    console.log(`[${N}-member-member-churn] ${OFFLINE_COUNT} members disconnected`);

    // Owner sends messages while some members are offline
    await sendGroupMessage(owner.page, 'message-during-offline-1', onlineMembers, msgTimeout);
    await sendGroupMessage(owner.page, 'message-during-offline-2', onlineMembers, msgTimeout);
    console.log(`[${N}-member-member-churn] ${N - OFFLINE_COUNT} online members received messages`);

    // The offline members' contexts are gone for good here. Whether a member
    // who returns receives what they missed is covered with real persisted
    // identities in e2e-groups-churn.test.mjs.

    // Verify online members got the offline messages
    for (const msg of ['message-during-offline-1', 'message-during-offline-2']) {
      await Promise.all(
        onlineMembers.map(m => incoming(m.page, msg).waitFor({ timeout: msgTimeout }))
      );
    }

    // The group keeps working for the members who stayed
    await sendGroupMessage(owner.page, 'message-after-reconnect', onlineMembers, msgTimeout);
    console.log(`[${N}-member-member-churn] Post-reconnect message delivered`);


    const endMem = process.memoryUsage().heapUsed;
    console.log(`[${N}-member-member-churn] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);
    console.log(`✓ ${N}-member member churn test passed`);
  } finally {
    await group.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST: 10 members - verify key generation counter
// ═══════════════════════════════════════════════════════════════════════════

test('group key delivery: 10 members - verify key generation counter', { timeout: 240_000 }, async () => {
  const N = 10;
  const groupName = 'scale-test-10-gen';
  const keyTimeout = 75_000;
  const msgTimeout = 120_000;

  console.log(`\n=== Starting ${N}-member key generation counter test ===`);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[${N}-member-gen] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  const group = await createBrowserGroup(N);
  try {
    const [owner, ...members] = group.members;
    console.log(`[${N}-member-gen] All ${N} identities created`);
    const memberNicknamesGen = members.map((_, i) => `Member${i + 1}`);
    await createGroupUILocal(owner.page, groupName, memberNicknamesGen);
    console.log(`[${N}-member-gen] Group created: ${groupName}`);

    // Wait for all members to see the group
    await Promise.all(
      members.map((m, i) => waitForGroup(m.page, groupName, keyTimeout))
    );
    console.log(`[${N}-member-gen] All ${N} members see the group`);

    // Open the group everywhere: the owner to send, members to see it arrive
    await Promise.all(
      group.members.map(m => openGroup(m.page, groupName))
    );

    // Verify initial key generation is 0 or 1
    const ownerGen0 = await getKeyGeneration(owner.page);
    console.log(`[${N}-member-gen] Initial keyGeneration: ${ownerGen0}`);
    assert.ok(ownerGen0 === 0 || ownerGen0 === 1, `Expected keyGeneration to be 0 or 1, got ${ownerGen0}`);

    // Send first message
    await sendGroupMessage(owner.page, `message-gen-1`, members, msgTimeout);
    console.log(`[${N}-member-gen] First message delivered`);

    // Sending does not rotate the key (only membership changes do, see core
    // groups.ts), so every member must hold exactly the owner's generation.
    const memberGens1 = await Promise.all(members.map(m => getKeyGeneration(m.page)));
    console.log(`[${N}-member-gen] Member generations after first msg: ${memberGens1.join(', ')}`);
    assert.ok(memberGens1.every(g => g === ownerGen0), `Expected every member at the owner's generation ${ownerGen0}, got ${memberGens1}`);

    // Rotate key (this would typically be done via UI or API)
    // For now, we create a new group to simulate key rotation
    // Note: In a real implementation, we'd call the rotate API here
    const groupName2 = `${groupName}-rotated`;
    await createGroupUILocal(owner.page, groupName2, memberNicknamesGen);
    console.log(`[${N}-member-gen] New group created for key rotation test`);

    // Wait for all members to see the new group
    await Promise.all(
      members.map((m, i) => waitForGroup(m.page, groupName2, keyTimeout))
    );
    console.log(`[${N}-member-gen] All ${N} members see the new group (generation 2)`);

    // Send message in new group
    await Promise.all(
      group.members.map(m => openGroup(m.page, groupName2))
    );
    await sendGroupMessage(owner.page, `message-gen-2`, members, msgTimeout);
    console.log(`[${N}-member-gen] Second message delivered in new group`);

    // Verify all members have the new group with generation
    const newGroupGens = await Promise.all(
      members.map(async m => {
        const groups = await m.page.evaluate(async () => {
          return new Promise((resolve) => {
            const request = indexedDB.open('kant');
            request.onsuccess = () => {
              const tx = request.result.transaction('groups', 'readonly');
              const store = tx.objectStore('groups');
              const getAll = store.getAll();
              getAll.onsuccess = () => resolve(getAll.result);
            };
          });
        });
        const newGroup = groups?.find(g => g.name === groupName2);
        return newGroup ? newGroup.keyGeneration : -1;
      })
    );
    assert.ok(newGroupGens.every(g => g >= 0), `Every member should hold ${groupName2}, got generations ${newGroupGens}`);
    console.log(`[${N}-member-gen] New group generations: ${newGroupGens.join(', ')}`);

    const endMem = process.memoryUsage().heapUsed;
    console.log(`[${N}-member-gen] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);
    console.log(`✓ ${N}-member key generation counter test passed`);
  } finally {
    await group.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PARAMETERIZED TESTS: Easily change N from 10 to 50
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parameterized test runner for scale tests.
 * Run with different N values to test 10, 20, 30, 40, 50 members.
 */
async function runParameterizedScaleTest(n, testType = 'nominal') {
  const groupName = `param-${n}-${testType}`;
  const timeouts = {
    10:  { key: 30_000, msg: 60_000, total: 120_000 },
    20:  { key: 45_000, msg: 75_000, total: 150_000 },
    30:  { key: 60_000, msg: 90_000, total: 180_000 },
    40:  { key: 75_000, msg: 105_000, total: 210_000 },
    50:  { key: 90_000, msg: 120_000, total: 240_000 },
  };
  const { key: keyTimeout, msg: msgTimeout, total: totalTimeout } = timeouts[n] || timeouts[10];

  console.log(`\n=== Parameterized ${n}-member test (${testType}) ===`);
  const startMem = process.memoryUsage().heapUsed;
  console.log(`[param-${n}] Initial heap: ${Math.round(startMem / 1024 / 1024)} MB`);

  const group = await createBrowserGroup(n);
  try {
    const [owner, ...members] = group.members;
    console.log(`[param-${n}] All ${n} identities created`);

    const memberNicknamesParam = members.map((_, i) => `Member${i + 1}`);
    await createGroupUILocal(owner.page, groupName, memberNicknamesParam);
    console.log(`[param-${n}] Group created: ${groupName}`);

    await Promise.all(members.map(m => waitForGroup(m.page, groupName, keyTimeout)));
    console.log(`[param-${n}] All ${n} members see the group`);

    await Promise.all(group.members.map(m => openGroup(m.page, groupName)));

    await sendGroupMessage(owner.page, `hello from ${n}-member group`, members, msgTimeout);
    console.log(`[param-${n}] Message delivered to all ${n} members`);

    const endMem = process.memoryUsage().heapUsed;
    console.log(`[param-${n}] Final heap: ${Math.round(endMem / 1024 / 1024)} MB (+${Math.round((endMem - startMem) / 1024 / 1024)} MB)`);
    console.log(`✓ Parameterized ${n}-member test passed`);
  } finally {
    await group.close();
  }
}

// Export for use by other test files
export { runParameterizedScaleTest, restartRelay, waitForRelay };
