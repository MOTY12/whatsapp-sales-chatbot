import { ApplicationLogger, databaseLogger } from './logging';

describe('safe logging', () => {
  afterEach(() => jest.restoreAllMocks());

  it('redacts configured credentials, DSNs, headers, query values and payloads', () => {
    const sink = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = new ApplicationLogger(['log'], {
      DATABASE_PASSWORD: 'fixture-db-password',
      META_APP_SECRET: 'fixture-meta-secret',
    });

    logger.log({
      message:
        'fixture-db-password fixture-meta-secret postgres://owner:db-pass@host/db Bearer tenant-token',
      url: 'https://graph.facebook.com/me?access_token=provider-token',
      headers: { authorization: 'private-header' },
      body: { message: 'customer text' },
    });

    const output = String(sink.mock.calls[0][0]);
    expect(output).toContain('[REDACTED]');
    for (const secret of [
      'fixture-db-password',
      'fixture-meta-secret',
      'db-pass',
      'tenant-token',
      'provider-token',
      'private-header',
      'customer text',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('keeps query text, parameters and driver messages out of database logs', () => {
    const sink = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const logger = databaseLogger(false);
    logger.logQueryError(
      Object.assign(new Error('customer text in driver error'), {
        code: '23505',
      }),
      'SELECT fixture_query',
      ['fixture-password'],
    );
    const output = String(sink.mock.calls[0][0]);
    expect(output).toContain('23505');
    expect(output).not.toMatch(/customer text|fixture_query|fixture-password/);
  });
});
