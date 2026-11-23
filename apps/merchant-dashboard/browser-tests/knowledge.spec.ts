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

async function openKnowledge(page: Page) {
  await page.goto(`/dashboard/knowledge?businessId=${businessId}`);
  await expect(
    page.getByRole('heading', { name: 'Knowledge Base' }),
  ).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

test('creates a draft, publishes it, keeps published content live during edits, and publishes a new revision', async ({
  page,
  request,
}) => {
  await signInAndCreateBusiness(page);
  await openKnowledge(page);
  await expect(page.getByText('No FAQs yet')).toBeVisible();
  await page.getByRole('button', { name: 'New FAQ' }).click();
  await page
    .getByLabel('Customer question')
    .fill('What are your opening hours?');
  await page.getByLabel('Approved answer').fill('We open at 9 AM on weekdays.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText(
      'Draft saved. It is not visible to customer replies until you publish it.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  expect(
    await (await request.get('http://localhost:3100/test/faqs')).json(),
  ).toEqual({ count: 1 });
  await page.getByRole('button', { name: 'Publish FAQ' }).click();
  await expect(
    page.getByText(
      'This FAQ revision is published and available to the knowledge retrieval service.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Published and live.')).toBeVisible();
  await page
    .getByLabel('Approved answer')
    .fill('We open at 8:30 AM on weekdays.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText(
      'The currently published answer remains live until you publish this revision.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Unpublished changes awaiting review.'),
  ).toBeVisible();
  await expect(
    page.getByText('Revision 2 · Published revision 1'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish FAQ' }).click();
  await expect(
    page.getByText('Revision 2 · Published revision 2'),
  ).toBeVisible();
});

test('validates form content and safely renders literal HTML as text', async ({
  page,
}) => {
  await signInAndCreateBusiness(page);
  await openKnowledge(page);
  await page.getByRole('button', { name: 'New FAQ' }).click();
  await page
    .getByLabel('Customer question')
    .fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    'Add an answer before saving.',
  );
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByLabel('Approved answer').fill('Plain text.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByText('<img src=x onerror=alert(1)>', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test('unpublishes old answers and removes them from the management status', async ({
  page,
}) => {
  await signInAndCreateBusiness(page);
  await openKnowledge(page);
  await page.getByRole('button', { name: 'New FAQ' }).click();
  await page.getByLabel('Customer question').fill('Do you deliver?');
  await page.getByLabel('Approved answer').fill('Yes, within the city.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Publish FAQ' }).click();
  await page.getByRole('button', { name: 'Unpublish' }).click();
  const confirmation = page.getByRole('group', {
    name: 'Confirm unpublishing FAQ',
  });
  await expect(confirmation).toContainText(
    'removes this answer from future customer retrieval',
  );
  await confirmation.getByRole('button', { name: 'Confirm unpublish' }).click();
  await expect(
    page.getByText(
      'This FAQ is unpublished and no longer available to customer retrieval.',
    ),
  ).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
});

test('switches businesses, handles editor access and reports API failures and session expiry', async ({
  page,
  request,
}) => {
  await request.get('http://localhost:3100/test/reset?multiple=1');
  await signInAndCreateBusiness(page);
  await page.goto(`/dashboard/knowledge?businessId=${businessId}`);
  await expect(page.getByText('No FAQs yet')).toBeVisible();
  await page.getByLabel('Select business').selectOption(secondBusinessId);
  await expect(page).toHaveURL(new RegExp(`businessId=${secondBusinessId}`));
  await expect(page.getByText('No FAQs yet')).toBeVisible();
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
  await page.goto('/dashboard/knowledge');
  await expect(
    page.getByRole('heading', { name: 'Knowledge access required' }),
  ).toBeVisible();
  await request.get('http://localhost:3100/test/reset?scenario=faq-failure');
  await page.goto('/login');
  await page
    .getByRole('link', { name: /continue with google/i })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Add your business profile' }),
  ).toBeVisible();
  await page.getByLabel(/business name/i).fill('Unavailable Shop');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await page.goto('/dashboard/knowledge');
  await expect(page.locator('p[role="alert"]')).toContainText(
    'could not complete',
  );
  await request.get('http://localhost:3100/test/reset');
  await signInAndCreateBusiness(page);
  await request.get('http://localhost:3100/test/expire');
  await page.goto('/dashboard/knowledge');
  await expect(page).toHaveURL(/\/login\?error=session/);
});
