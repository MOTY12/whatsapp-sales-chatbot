import { merchantEmailAuthConfig } from '../config/env';

export const EMAIL_CONFIG = Symbol('EMAIL_CONFIG');
export type EmailConfig = Extract<
  ReturnType<typeof merchantEmailAuthConfig>,
  { enabled: true }
>;
