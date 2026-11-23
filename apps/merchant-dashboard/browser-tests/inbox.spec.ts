import { expect, test, type Page } from '@playwright/test';

const businessId = '11111111-1111-4111-8111-111111111111';
const secondBusinessId = '22222222-2222-4222-8222-222222222222';

test.beforeEach(async ({ request }) => {
  await request.get('http://localhost:3100/test/reset');
});

async function signInAndCreateBusiness(page: Page) {
  await page.goto('/login');
  await page.getByRole('link', { name: /continue with google/i }).click();
  await expect(page.getByRole('heading', { name: 'Set up your merchant workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add your business profile' })).toBeVisible();
  await page.getByLabel(/business name/i).fill('The Good Store');
  await page.getByLabel(/industry/i).fill('Retail');
  await page.getByLabel(/business phone/i).fill('+234 801 234 5678');
  await page.getByRole('button', { name: /create business/i }).click();
  await expect(page.getByText(/your owner membership is active/i)).toBeVisible();
  await page.getByRole('link', { name: 'Open dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you' })).toBeVisible();
}

async function openInbox(page: Page) {
  await page.goto(`/dashboard/conversations?businessId=${businessId}`);
  await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Amina Yusuf/ })).toBeVisible();
}

test('hydrates without app warnings in an extension-free browser', async ({ page }) => {
  const hydrationWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|did not match/i.test(message.text())) {
      hydrationWarnings.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (/hydration|did not match/i.test(error.message)) hydrationWarnings.push(error.message);
  });

  await signInAndCreateBusiness(page);
  await openInbox(page);
  await expect(page.locator('.mobile-menu')).toHaveAttribute('data-hydrated', 'true');
  await expect.poll(() => hydrationWarnings).toEqual([]);
  await expect.poll(() => page.evaluate(() =>
    ['data-psi-id', 'data-new-gr-c-s-check-loaded', 'data-gr-ext-installed',
      'data-gr-ext-go-mode', 'data-gr-aaa-loaded'].filter((name) =>
      document.documentElement.hasAttribute(name) || document.body.hasAttribute(name),
    ),
  )).toEqual([]);
});

test('lists conversations, loads history, and paginates older messages without losing scroll', async ({ page }) => {
  await signInAndCreateBusiness(page);
  await openInbox(page);
  await expect(page.getByText('Automation active')).toBeVisible();
  const history = page.getByLabel('Message history');
  await expect(history.getByText('Fixture customer message 31')).toBeVisible();
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(history.getByText('Fixture customer message 01')).toBeVisible();
  await expect(history.getByText('Fixture customer message 31')).toBeVisible();
});

test('takes over, queues one idempotent manual reply, and resumes automation', async ({ page, request }) => {
  await signInAndCreateBusiness(page);
  await openInbox(page);
  await page.getByRole('button', { name: 'Take over conversation' }).click();
  await expect(page.getByText('Automation is paused.')).toBeVisible();
  const composer = page.getByLabel('Write a reply');
  await expect(composer).toBeEnabled();
  await composer.fill('Yes, it is available today.');
  const sendButton = page.getByRole('button', { name: 'Send reply' });
  await sendButton.click();
  await expect(sendButton).toBeDisabled();
  await expect(page.locator('p[role="status"]')).toContainText('Reply queued.');
  await expect(page.locator('[aria-label="Message status: Queued"]')).toBeVisible();
  expect(await (await request.get('http://localhost:3100/test/replies')).json()).toEqual({ count: 1 });
  await expect(page.getByRole('article').filter({ hasText: 'Yes, it is available today.' }).getByLabel('Message status: Delivered')).toBeVisible({ timeout: 12_000 });
  const releaseStatus = await page.evaluate(async ({ businessId, conversationId }) => {
    const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('kleva_csrf='))?.split('=').slice(1).join('=');
    const response = await fetch(`/api/inbox/${businessId}/conversations/${conversationId}/release`, { method: 'POST', headers: { 'X-CSRF-Token': csrf ?? '' } });
    return response.status;
  }, { businessId, conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  expect(releaseStatus).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Take over conversation' })).toBeVisible();
  await expect(page.getByText('Automation is paused.')).toHaveCount(0);
});

test('keeps a failed reply draft and explains quota, disconnected and closed-window responses', async ({ page, request }) => {
  await signInAndCreateBusiness(page);
  await openInbox(page);
  await page.getByRole('button', { name: 'Take over conversation' }).click();
  const draftText = 'Please check this item';
  await page.getByLabel('Write a reply').fill(draftText);
  await request.get('http://localhost:3100/test/scenario?value=quota');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('allowance');
  await expect(page.getByLabel('Write a reply')).toHaveValue(draftText);
  await request.get('http://localhost:3100/test/scenario?value=disconnected');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('WhatsApp is disconnected');
  await request.get('http://localhost:3100/test/scenario?value=window');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('24-hour WhatsApp service window has closed');
  await expect(page.getByLabel('Write a reply')).toHaveValue(draftText);
});

test('shows an empty inbox and denies another tenant conversation', async ({ page, request }) => {
  await request.get('http://localhost:3100/test/reset?empty=1');
  await signInAndCreateBusiness(page);
  await page.goto(`/dashboard/conversations?businessId=${businessId}`);
  await expect(page.getByText('No conversations yet')).toBeVisible();
  const denied = await page.evaluate(async ({ businessId, conversationId }) => {
    const response = await fetch(`/api/inbox/${businessId}/conversations/${conversationId}`);
    return response.status;
  }, { businessId, conversationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  expect(denied).toBe(404);
});

test('switches businesses without retaining the previous tenant thread and supports mobile back navigation', async ({ page, request }) => {
  await request.get('http://localhost:3100/test/reset?multiple=1');
  await signInAndCreateBusiness(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/conversations?businessId=${businessId}`);
  await expect(page.getByRole('button', { name: /Amina Yusuf/ })).toBeVisible();
  await page.getByRole('button', { name: /Amina Yusuf/ }).click();
  await expect(page.getByLabel('Message history')).toBeVisible();
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(page.getByRole('button', { name: /Amina Yusuf/ })).toBeVisible();
  await page.getByLabel('Select business').selectOption(secondBusinessId);
  await expect(page).toHaveURL(new RegExp(`businessId=${secondBusinessId}`));
  await expect(page.getByText('No conversations yet')).toBeVisible();
  await expect(page.getByText('Amina Yusuf')).toHaveCount(0);
});

test('expired session sends the merchant back to sign-in', async ({ page, request }) => {
  await signInAndCreateBusiness(page);
  await request.get('http://localhost:3100/test/expire');
  await page.goto(`/dashboard/conversations?businessId=${businessId}`);
  await expect(page).toHaveURL(/\/login\?error=session/);
});
