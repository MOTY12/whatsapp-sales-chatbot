import { describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

vi.mock('next/navigation', () => ({
  redirect: (location: string) => {
    throw new Error(`REDIRECT:${location}`);
  },
}));

describe('merchant login page', () => {
  it('removes credentials from the URL and explains that they were ignored', async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          email: 'merchant@example.test',
          password: 'should-not-be-used',
        }),
      }),
    ).rejects.toThrow('REDIRECT:/login?error=credentials_in_url');
  });

  it('also removes an email-only login link instead of treating it as a credential', async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({ email: 'merchant@example.test' }),
      }),
    ).rejects.toThrow('REDIRECT:/login?error=credentials_in_url');
  });
});
