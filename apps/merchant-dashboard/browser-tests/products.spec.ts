import { expect, test, type Page } from '@playwright/test';

const businessId = '11111111-1111-4111-8111-111111111111';
const secondBusinessId = '22222222-2222-4222-8222-222222222222';

async function signInAndCreateBusiness(page: Page) {
  await page.goto('/login');
  await page
    .getByRole('link', { name: /continue with google/i })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Add your business profile' }),
  ).toBeVisible();
  await page.getByLabel(/business name/i).fill('The Good Store');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(page.getByText(/your owner membership is active/i)).toBeVisible();
  await page.getByRole('link', { name: 'Open dashboard' }).click();
  await expect(
    page.getByRole('heading', { name: 'Good to see you' }),
  ).toBeVisible();
}

async function openProducts(page: Page) {
  await page.goto(`/dashboard/products?businessId=${businessId}`);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

test('creates, publishes, edits, republishes, and unpublishes a product safely', async ({
  page,
  request,
}) => {
  await signInAndCreateBusiness(page);
  await openProducts(page);
  await expect(page.getByText('No products yet')).toBeVisible();
  await page.getByRole('button', { name: /New product/ }).click();
  await page.getByLabel(/Product name/).fill('Classic leather handbag');
  await page.getByLabel(/Description/).fill('Handmade in Lagos.');
  await expect(page.getByLabel('Availability')).toHaveValue('UNKNOWN');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText(
      'Draft saved. It stays hidden from customers until published.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Price not set').first()).toBeVisible();
  await expect(page.getByText('Availability unknown').first()).toBeVisible();
  await expect(
    await (await request.get('http://localhost:3100/test/products')).json(),
  ).toEqual({ count: 1 });

  await page.getByRole('button', { name: 'Publish product' }).click();
  await expect(page.getByText('Product published.')).toBeVisible();
  await expect(
    page.getByText(
      'Published product information is available to customer retrieval.',
    ),
  ).toBeVisible();
  await page
    .getByLabel(/Description/)
    .fill('Handmade in Lagos from locally sourced leather.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText(
      'The published product stays live until you publish this revision.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Unpublished changes awaiting review.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish updates' }).click();
  await expect(page.getByText('Product published.')).toBeVisible();
  await page.getByRole('button', { name: 'Unpublish' }).click();
  const confirmation = page.getByRole('group', {
    name: 'Confirm unpublishing product',
  });
  await expect(confirmation).toContainText(
    'removes the product from future customer retrieval',
  );
  await confirmation.getByRole('button', { name: 'Confirm unpublish' }).click();
  await expect(page.getByText('Product unpublished.')).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
});

test('validates decimal prices and displays an exact currency amount', async ({
  page,
}) => {
  await signInAndCreateBusiness(page);
  await openProducts(page);
  await page.getByRole('button', { name: /New product/ }).click();
  await page.getByLabel(/Product name/).fill('Precise item');
  await page.locator('#product-price').fill('-1.25');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    'Enter a non-negative price with up to two decimal places.',
  );
  await page.locator('#product-price').fill('900719925474.09');
  await page.getByLabel('Price currency').selectOption('USD');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('USD 900719925474.09')).toBeVisible();
  await expect(page.getByText('Availability unknown').first()).toBeVisible();
});

test('switches businesses and denies agent product access', async ({
  page,
  request,
}) => {
  await request.get('http://localhost:3100/test/reset?multiple=1');
  await signInAndCreateBusiness(page);
  await openProducts(page);
  await page.getByLabel('Select business').selectOption(secondBusinessId);
  await expect(page).toHaveURL(new RegExp(`businessId=${secondBusinessId}`));
  await expect(page.getByText('No products yet')).toBeVisible();

  await request.get('http://localhost:3100/test/reset?role=agent');
  await page.goto('/login');
  await page
    .getByRole('link', { name: /continue with google/i })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Add your business profile' }),
  ).toBeVisible();
  await page.getByLabel(/business name/i).fill('Agent Shop');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await page.goto('/dashboard/products');
  await expect(
    page.getByRole('heading', { name: 'Product access required' }),
  ).toBeVisible();
});

test('reports service failure and redirects after an expired session', async ({
  page,
  request,
}) => {
  await request.get(
    'http://localhost:3100/test/reset?scenario=product-failure',
  );
  await signInAndCreateBusiness(page);
  await page.goto('/dashboard/products');
  await expect(page.getByRole('alert').first()).toContainText(
    'Kleva could not complete that request. Please try again.',
  );
  await request.get('http://localhost:3100/test/reset');
  await signInAndCreateBusiness(page);
  await request.get('http://localhost:3100/test/expire');
  await page.goto('/dashboard/products');
  await expect(page).toHaveURL(/\/login\?error=session/);
});

test('shows product editing controls on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAndCreateBusiness(page);
  await openProducts(page);
  await expect(page.getByRole('button', { name: /New product/ })).toBeVisible();
  await page.getByRole('button', { name: /New product/ }).click();
  await expect(page.getByLabel(/Product name/)).toBeVisible();
  await expect(page.getByRole('button', { name: '← Catalog' })).toBeVisible();
});
