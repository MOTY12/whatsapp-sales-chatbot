import { expect, test } from '@playwright/test';

const businessId = '11111111-1111-4111-8111-111111111111';

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

test('owner can inspect responsive analytics and filter by range and channel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByRole('link', { name: /continue with google/i }).click();
  await page.getByLabel(/business name/i).fill('Analytics Shop');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(page.getByText(/your owner membership is active/i)).toBeVisible();

  await page.goto(`/dashboard/analytics?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Analytics', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Customer conversations', { exact: true })).toBeVisible();
  await expect(page.getByText('Recorded conversions', { exact: true })).toBeVisible();
  await expect(page.getByText('3 messages')).toBeVisible();

  await page.getByLabel('Quick range').selectOption('7d');
  await page.getByLabel('Channel').first().selectOption('WEBSITE');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/preset=7d/);
  await expect(page).toHaveURL(/channel=WEBSITE/);
  await expect(page.getByRole('table')).toContainText('Website chat');
});
