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
}

async function publishDeliveryFaq(page: Page) {
  await page.goto(`/dashboard/knowledge?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Knowledge Base' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New FAQ' }).click();
  await page.getByLabel('Customer question').fill('Do you deliver to Ikeja?');
  await page
    .getByLabel('Approved answer')
    .fill('Yes, we deliver to Ikeja within one business day.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText(
      'Draft saved. It is not visible to customer replies until you publish it.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish FAQ' }).click();
  await expect(page.getByText('Published and live.')).toBeVisible();
}

async function publishPricedProduct(page: Page) {
  await page.goto(`/dashboard/products?businessId=${businessId}`);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await page.getByRole('button', { name: /New product/ }).click();
  await page.getByLabel(/Product name/).fill('Classic leather handbag');
  await page.getByLabel(/Description/).fill('Handmade in Lagos from leather.');
  await page.locator('#product-price').fill('25000.00');
  await page.getByLabel('Price currency').selectOption('NGN');
  await page.getByLabel('Availability').selectOption('IN_STOCK');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText(
      'Draft saved. It stays hidden from customers until published.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish product' }).click();
  await expect(page.getByText('Product published.')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

test('tests grounded and unknown questions without creating customer activity', async ({
  page,
  request,
}) => {
  await signInAndCreateBusiness(page);
  await publishDeliveryFaq(page);
  await publishPricedProduct(page);
  await page.goto(`/dashboard/assistant?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'AI Assistant' }),
  ).toBeVisible();
  await page.getByLabel('Preferred language').selectOption('NIGERIAN_PIDGIN');
  await page.getByRole('button', { name: 'Save assistant settings' }).click();
  await expect(page.getByText(/Assistant settings saved/)).toBeVisible();

  await page
    .getByLabel('Test customer message')
    .fill('How much is the handbag?');
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(
    page.getByText('Classic leather handbag costs NGN 25,000.00.'),
  ).toBeVisible();
  await expect(
    page.getByText(/Product · Classic leather handbag/),
  ).toBeVisible();

  await page
    .getByLabel('Test customer message')
    .fill('Una dey deliver reach Ikeja?');
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(
    page.getByText(
      'Yes o, we dey deliver reach Ikeja within one business day.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Grounded answer').last()).toBeVisible();
  await expect(page.getByText('Do you deliver to Ikeja?').first()).toBeVisible();

  await page
    .getByLabel('Test customer message')
    .fill('Do you offer a special discount?');
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Not enough published evidence')).toBeVisible();
  await expect(
    page.getByText('A human handoff would be recommended').last(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset test' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset test' }).click();
  await expect(page.getByText('Not enough published evidence')).toHaveCount(0);

  expect(
    await (await request.get('http://localhost:3100/test/assistant')).json(),
  ).toEqual({ requests: 3 });
  expect(
    await (await request.get('http://localhost:3100/test/leads')).json(),
  ).toEqual({ count: 0 });
});

test('keeps the settings and playground usable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signInAndCreateBusiness(page);
  await page.goto(`/dashboard/assistant?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Test a conversation' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel('Preferred language')).toBeVisible();
  await expect(page.getByLabel('Test customer message')).toBeVisible();
});
