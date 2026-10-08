import { assertRequiredEnv } from './env';

describe('assertRequiredEnv', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('throws a clear error when database settings are missing', () => {
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_USER;
    delete process.env.DATABASE_PASSWORD;
    delete process.env.DATABASE_NAME;

    expect(() => assertRequiredEnv()).toThrow(
      /Missing required environment variables: DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME/,
    );
  });

  it('passes when required database settings are present', () => {
    process.env.DATABASE_HOST = 'localhost';
    process.env.DATABASE_USER = 'postgres';
    process.env.DATABASE_PASSWORD = 'secret';
    process.env.DATABASE_NAME = 'kleva_db';

    expect(() => assertRequiredEnv()).not.toThrow();
  });
});
