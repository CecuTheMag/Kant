import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const webUrl = 'http://localhost:8080';
const relayUrl = 'http://localhost:3001';

const browser = await chromium.launch({ headless: true });

const makeClient = async (label) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript((opts) => {
    try {
      localStorage.setItem('kant_ui', 'legacy');
      localStorage.setItem('kant_relay_url', opts.relayUrl);
    } catch {}
  }, { relayUrl });
  const page = await ctx.newPage();
  page.on('console', m => process.stderr.write(`[${label}] ${m.text()}\n`));
  page.on('pageerror', e => process.stderr.write(`[${label}] PAGE ERROR: ${e.message}\n`));
  await page.goto(webUrl);
  await page.getByPlaceholder('Enter password').fill(`KantE2E-${label}-2026!`);
  await page.getByPlaceholder('Repeat password').fill(`KantE2E-${label}-2026!`);
  await page.getByRole('button', { name: 'Create Identity' }).click();
  await page.getByRole('button', { name: 'Add contact' }).first().waitFor({ timeout: 30000 });
  return { ctx, page };
};

const alice = await makeClient('Alice');
const bob = await makeClient('Bob');

const getKey = async (page) => page.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('kant');
  r.onsuccess = () => { const g = r.result.transaction('identity','readonly').objectStore('identity').get('keypair'); g.onsuccess = () => res(g.result?.publicKeyHex ?? ''); };
}));

const [aliceKey, bobKey] = await Promise.all([getKey(alice.page), getKey(bob.page)]);
console.log('Alice:', aliceKey.slice(0,16), 'Bob:', bobKey.slice(0,16));

// Add contacts
const addContact = async (page, hex, nick) => {
  await page.getByRole('button', { name: 'Add contact' }).first().click();
  await page.getByPlaceholder('64 hex characters…').fill(hex);
  await page.getByPlaceholder('e.g. Alice').fill(nick);
  await page.getByRole('button', { name: 'Add Contact', exact: true }).click();
  await page.getByText(nick).first().waitFor();
};
await Promise.all([addContact(alice.page, bobKey, 'Bob E2E'), addContact(bob.page, aliceKey, 'Alice E2E')]);
console.log('contacts added');

// Connect
const connect = async (page, label) => {
  const btn = page.getByRole('button', { name: 'Connect to Network' });
  if (await btn.isVisible().catch(() => false)) await btn.click();
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const addr = await page.evaluate(() => window.__kantCircuitAddr ?? '').catch(() => '');
    if (addr && addr.includes('/p2p-circuit')) { console.log(`${label} circuit: ${addr.slice(-30)}`); return addr; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${label} no circuit`);
};
const [aliceCircuit, bobCircuit] = await Promise.all([connect(alice.page, 'Alice'), connect(bob.page, 'Bob')]);

// Inject circuit addrs
const injectAddr = async (page, hex, addr) => page.evaluate(async ({hex, addr}) => {
  await new Promise(res => {
    const r = indexedDB.open('kant');
    r.onsuccess = () => {
      const tx = r.result.transaction('contacts','readwrite');
      const s = tx.objectStore('contacts');
      const g = s.get(hex);
      g.onsuccess = () => { s.put({...(g.result ?? {publicKeyHex:hex}), lastCircuitAddr:addr}); tx.oncomplete = res; };
    };
  });
}, {hex, addr});
await Promise.all([injectAddr(alice.page, bobKey, bobCircuit), injectAddr(bob.page, aliceKey, aliceCircuit)]);
console.log('circuit addrs injected');

// Create group
await alice.page.getByRole('button', { name: 'Groups' }).click();
await alice.page.getByRole('button', { name: 'Create group' }).first().click();
await alice.page.getByPlaceholder('e.g. Team Alpha').fill('debug-group');
const modal = alice.page.locator('.modal-mobile-full');
const memberCount = await modal.locator('.memberInfo').count();
console.log('.memberInfo count:', memberCount);
if (memberCount > 0) {
  await modal.locator('.memberInfo', { hasText: 'Bob E2E' }).first().click();
  console.log('selected Bob E2E');
}
await alice.page.getByRole('button', { name: 'Create Group', exact: true }).click();
console.log('clicked Create Group');

// Wait for group to appear
try {
  await alice.page.getByText('debug-group').first().waitFor({ timeout: 10000 });
  console.log('group appeared in list');
} catch(e) {
  console.log('group did NOT appear:', e.message);
  const errText = await alice.page.locator('body').innerText().catch(() => '');
  console.log('page text:', errText.slice(0, 300));
}

// Wait for key status
console.log('waiting for .group-key-status...');
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const status = await alice.page.locator('.group-key-status').textContent().catch(() => '');
  console.log(`t+${i+1}s status: "${status}"`);
  if (status === 'Key distributed') { console.log('SUCCESS'); break; }
}

await browser.close();
