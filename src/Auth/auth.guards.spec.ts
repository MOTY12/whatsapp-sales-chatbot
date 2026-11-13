import type { Request } from 'express';
import { cookie, cookieNames } from './auth.guards';

describe('merchant cookie handling', () => {
  it('uses host-prefixed cookie names for HTTPS merchant sessions', () => {
    expect(cookieNames(true)).toEqual({
      binding: '__Host-kleva_oidc_binding',
      session: '__Host-kleva_session',
      csrf: '__Host-kleva_csrf',
    });
  });

  it('rejects ambiguous session cookies and ignores similarly named cookies', () => {
    const { session } = cookieNames(false);
    const read = (header: string) =>
      cookie({ get: () => header } as unknown as Request, session);

    expect(read(`other_${session}=ignore; ${session}=session-token`)).toBe(
      'session-token',
    );
    expect(read(`${session}=one; ${session}=two`)).toBeUndefined();
  });
});
