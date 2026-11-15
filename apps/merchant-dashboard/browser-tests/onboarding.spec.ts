import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

test('merchant signs in, creates a business, sees setup, and edits profile', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?error=session/);
  await page.getByRole('link', { name: /continue with secure sign-in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
  await page.getByLabel(/business name/i).fill('The Good Store');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(page.getByText('Your business is ready.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Good Store' })).toBeVisible();
  await expect(page.getByText('Not connected')).toBeVisible();
  await page.getByRole('link', { name: /edit business/i }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByLabel(/business name/i).fill('The Better Store');
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect(page.getByRole('status')).toContainText('Business profile saved.');
  await page.goto('/dashboard/whatsapp?businessId=11111111-1111-4111-8111-111111111111');
  await expect(page.getByRole('heading', { name: 'WhatsApp connection' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect with help from our team' })).toBeVisible();
  await page.goto('/dashboard/settings?businessId=another-business');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('mobile navigation opens, closes, and navigates accessibly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('link', { name: /continue with secure sign-in/i }).click();
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
  await page.getByLabel(/business name/i).fill('Mobile Shop');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  const openButton = page.getByRole('button', { name: 'Open navigation' });
  await expect(openButton).toHaveAttribute('data-hydrated', 'true');
  await openButton.click();
  await expect(page.locator('.mobile-menu')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /conversations/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/conversations$/);
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.mobile-menu')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
