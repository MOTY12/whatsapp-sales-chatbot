export type TransactionalEmail = {
  subject: string;
  text: string;
  html: string;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );

function render(
  subject: string,
  greeting: string,
  message: string,
  action?: { label: string; url: string },
  note?: string,
): TransactionalEmail {
  const safeGreeting = escapeHtml(greeting);
  const safeMessage = escapeHtml(message);
  const safeNote = note ? escapeHtml(note) : '';
  const safeUrl = action ? escapeHtml(action.url) : '';
  const text = `${greeting}\n\n${message}${action ? `\n\n${action.label}: ${action.url}` : ''}${note ? `\n\n${note}` : ''}\n\nKleva`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#18212f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:32px"><tr><td><p style="font-size:22px;font-weight:bold;color:#125c4b;margin:0 0 24px">Kleva</p><h1 style="font-size:22px;line-height:1.35">${safeGreeting}</h1><p style="font-size:16px;line-height:1.6">${safeMessage}</p>${action ? `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#126b57;color:#fff;text-decoration:none;padding:14px 22px;border-radius:7px;font-weight:bold">${escapeHtml(action.label)}</a></p><p style="font-size:13px;line-height:1.6;word-break:break-all">If the button does not work, copy this link:<br>${safeUrl}</p>` : ''}${note ? `<p style="font-size:14px;line-height:1.6;color:#536173">${safeNote}</p>` : ''}<hr style="border:0;border-top:1px solid #e6e9ed;margin:28px 0"><p style="font-size:12px;color:#667085">Kleva merchant tools</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export const verificationEmail = (name: string, url: string) =>
  render(
    'Verify your Kleva merchant account',
    `Hello ${name},`,
    'Verify your email address to finish creating your Kleva merchant account.',
    { label: 'Verify email', url },
    'This link expires in 30 minutes and can only be used once. If you did not register, you can ignore this email.',
  );

export const passwordResetEmail = (name: string, url: string) =>
  render(
    'Reset your Kleva password',
    `Hello ${name},`,
    'Use the secure link below to choose a new password for your Kleva account.',
    { label: 'Reset password', url },
    'This link expires in 15 minutes and can only be used once. If you did not request a reset, ignore this email and your password will remain unchanged.',
  );

export const welcomeEmail = (name: string, dashboardUrl: string) =>
  render(
    'Welcome to Kleva',
    `Welcome, ${name}!`,
    'Your merchant account is ready. Continue onboarding by adding your business profile, connecting WhatsApp, and setting up products and FAQs.',
    { label: 'Continue onboarding', url: dashboardUrl },
  );

export const passwordChangedEmail = (name: string) =>
  render(
    'Your Kleva password was changed',
    `Hello ${name},`,
    'The password for your Kleva merchant account was changed.',
    undefined,
    'If you did not make this change, contact Kleva support immediately.',
  );
