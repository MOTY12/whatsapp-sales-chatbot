import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
  welcomeEmail,
} from './transactional-email';

describe('transactional email templates', () => {
  it('renders verification and password reset with HTML escaping and text alternatives', () => {
    const verification = verificationEmail(
      '<Merchant>',
      'https://example.test/verify?token=abc',
    );
    const reset = passwordResetEmail(
      'Merchant',
      'https://example.test/reset?token=abc',
    );
    expect(verification.html).toContain('Hello &lt;Merchant&gt;,');
    for (const message of [verification, reset]) {
      expect(message.text).toContain('https://example.test/');
      expect(message.html).toContain('href=');
    }
  });

  it('renders welcome and password-changed notices without credentials', () => {
    expect(
      welcomeEmail('Merchant', 'https://example.test/onboarding').text,
    ).toContain('Continue onboarding');
    expect(passwordChangedEmail('Merchant').text).toContain(
      'contact Kleva support',
    );
  });
});
