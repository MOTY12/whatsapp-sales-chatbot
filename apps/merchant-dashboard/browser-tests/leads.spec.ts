import { expect, test, type Page } from '@playwright/test';
const businessId = '11111111-1111-4111-8111-111111111111';
async function signInAndCreateBusiness(page: Page) {
  await page.goto('/login');
  await page.getByRole('link', { name: /continue with google/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Add your business profile' }),
  ).toBeVisible();
  await page.getByLabel(/business name/i).fill('The Good Store');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(
    page.getByText(/your owner membership is active/i),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open dashboard' }).click();
  await expect(
    page.getByRole('heading', { name: 'Good to see you' }),
  ).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});
test('captures a lead, updates its status and opens its source conversation', async ({
  page,
  request,
}) => {
  await signInAndCreateBusiness(page);
  await page.goto(`/dashboard/leads?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Leads', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(/No leads yet/)).toBeVisible();
  await request.post('http://localhost:3100/test/leads');
  await page.reload();
  await expect(page.getByText('Amina').first()).toBeVisible();
  await page.getByLabel('Lead status').selectOption('CONTACTED');
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(page.getByText('Lead status updated.')).toBeVisible();
  await page.getByRole('link', { name: 'Open conversation history' }).click();
  await expect(page).toHaveURL(/dashboard\/conversations\?.*conversationId=/);
  await expect(
    page.getByRole('heading', { name: 'Conversations' }),
  ).toBeVisible();
});

test('qualifies a lead and records a manual Won outcome', async ({
  page,
  request,
}) => {
  await signInAndCreateBusiness(page);
  await request.post('http://localhost:3100/test/leads');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/leads?businessId=${businessId}`);
  await expect(page.getByLabel('Product of interest')).toBeVisible();
  await page.getByLabel('Lead status').selectOption('CONTACTED');
  await page.getByRole('button', { name: 'Save status' }).click();
  await page.getByLabel('Product of interest').fill('Handwoven tote');
  await page.getByRole('button', { name: 'Mark as qualified' }).click();
  await expect(page.getByText(/Lead qualified/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark as Won' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Reference (optional)').fill('receipt-from-merchant');
  await page.getByRole('button', { name: 'Confirm outcome' }).click();
  await expect(page.getByText(/Lead recorded as WON/)).toBeVisible();
  await expect(page.getByText(/Outcome WON/)).toBeVisible();
});

test('loads and saves a versioned service qualification policy', async ({
  page,
}) => {
  await signInAndCreateBusiness(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/leads/settings?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Qualification settings' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use service template' }).click();
  await expect(page.getByLabel('Display label').first()).toBeVisible();
  await expect(page.getByText('service_required')).toBeVisible();
  await page.getByRole('button', { name: 'Save qualification policy' }).click();
  await expect(page.getByText(/Policy version 2 saved/)).toBeVisible();
});
