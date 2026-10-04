import { test, expect } from '@playwright/test';

test.describe('Kant UI smoke', () => {
  test('renders a usable authentication surface', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    const interactive = page.locator('button, input, [role="button"]');
    await expect(interactive.first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(page.locator('body')).not.toContainText('NaN');

    const unlabeled = await page.locator('button').evaluateAll((buttons) => buttons
      .filter((button) => !(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim()))
      .map((button) => button.outerHTML));
    expect(unlabeled, 'every button must have visible or accessible text').toEqual([]);
  });

  test('validates identity setup before creating anything', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    const relayField = page.locator('#relay');
    const nameField = page.getByPlaceholder('How friends will see you');
    await expect(relayField.or(nameField).first()).toBeVisible();
    if (await relayField.isVisible()) {
      await relayField.fill(process.env.KANT_RELAY_URL ?? 'http://relay:3001');
      await relayField.press('Enter');
    }
    await nameField.fill('Validation');
    const password = page.getByPlaceholder('At least 8 characters');
    const confirm = page.getByPlaceholder('Type it again');
    const create = page.getByRole('button', { name: 'Create', exact: true });

    await password.fill('short');
    await confirm.fill('short');
    await create.click();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();

    await password.fill('KantTest-2026!');
    await confirm.fill('different-password');
    await create.click();
    await expect(page.getByText('The passwords don’t match.')).toBeVisible();
    // Nothing was created: still on the setup screen, no identity stored.
    await expect(nameField).toBeVisible();
    const stored = await page.evaluate(() => new Promise(resolve => {
      const request = indexedDB.open('kant');
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        try {
          const get = request.result.transaction('identity', 'readonly').objectStore('identity').get('keypair');
          get.onsuccess = () => resolve(!!get.result);
          get.onerror = () => resolve(false);
        } catch { resolve(false); }
      };
    }));
    expect(stored).toBe(false);
  });

  test('has no horizontal overflow on mobile width', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await context.close();
  });
});
