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

  test('validates identity setup before touching the network', async ({ page }) => {
    await page.goto('/');
    const password = page.getByPlaceholder('Enter password');
    const confirm = page.getByPlaceholder('Repeat password');
    if (await confirm.count()) {
      await password.fill('KantTest-2026!');
      await confirm.fill('different-password');
      await page.getByRole('button', { name: 'Create Identity' }).click();
      await expect(page.getByText('Passwords do not match')).toBeVisible();
    }
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
