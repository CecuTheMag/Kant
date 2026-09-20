import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('kant_ui', 'legacy');
    localStorage.setItem('kant_relay_url', 'http://localhost:3001');
  } catch {}
});
const page = await ctx.newPage();
page.on('console', m => {
  process.stderr.write('[page] ' + m.text() + '\n');
});
await page.goto('http://localhost:8080');
await page.getByPlaceholder('Enter password').fill('Test123!');
await page.getByPlaceholder('Repeat password').fill('Test123!');
await page.getByRole('button', { name: 'Create Identity' }).click();
await page.getByRole('button', { name: 'Add contact' }).first().waitFor({ timeout: 30000 });
console.log('identity ready');
const btn = page.getByRole('button', { name: 'Connect to Network' });
console.log('btn visible:', await btn.isVisible());
await btn.click();
console.log('clicked connect');
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const addr = await page.evaluate(() => window.__kantCircuitAddr ?? '');
  console.log(`t+${i+1}s addr: ${addr || 'empty'}`);
  if (addr) break;
}
await browser.close();
