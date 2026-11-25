import { expect, test, type Page } from '@playwright/test';

const businessId = '11111111-1111-4111-8111-111111111111';

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

async function createBusiness(page: Page) {
  await page.goto('/login');
  await page.getByRole('link', { name: /continue with google/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Set up your merchant workspace' }),
  ).toBeVisible();
  await page.getByLabel(/business name/i).fill('The Good Store');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(page.getByText(/your owner membership is active/i)).toBeVisible();
}

test('owner invites a teammate and sees the durable invitation status', async ({
  page,
}) => {
  await createBusiness(page);
  await page.goto(`/dashboard/settings/team?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Team', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('merchant@example.test')).toBeVisible();

  await page.getByLabel('Email address').fill('reception@example.test');
  await page.getByLabel('Role').selectOption('agent');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  await expect(page.getByRole('status')).toContainText('Invitation queued.', {
    timeout: 15_000,
  });
  await expect(page.getByText('reception@example.test')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'queued' })).toBeVisible();
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
});
