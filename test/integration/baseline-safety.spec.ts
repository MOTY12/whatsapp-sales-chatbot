import { integrationConfig } from './postgres';

const valid = {
  NODE_ENV: 'test',
  KLEVA_TEST_PG_HOST: '127.0.0.1',
  KLEVA_TEST_PG_PORT: '5432',
  KLEVA_TEST_PG_DATABASE: 'kleva_integration_control',
  KLEVA_TEST_PG_USER: 'integration_admin',
  KLEVA_TEST_PG_PASSWORD: 'fixture',
};

describe('PostgreSQL integration configuration', () => {
  it('uses dedicated settings instead of application or pg defaults', () => {
    expect(
      integrationConfig({
        ...valid,
        DATABASE_NAME: 'kleva_db',
        DATABASE_HOST: 'app.example.test',
        DATABASE_USER: 'app',
        PGDATABASE: 'app',
      }),
    ).toMatchObject({
      database: 'kleva_integration_control',
      host: '127.0.0.1',
      username: 'integration_admin',
      synchronize: false,
    });
  });

  it.each([
    ['production mode', { NODE_ENV: 'production' }, /production/],
    [
      'missing database',
      { KLEVA_TEST_PG_DATABASE: undefined },
      /KLEVA_TEST_PG_DATABASE/,
    ],
    [
      'application database',
      { KLEVA_TEST_PG_DATABASE: 'kleva_db' },
      /KLEVA_TEST_PG_DATABASE/,
    ],
    [
      'integration database configured as the application database',
      { DATABASE_NAME: 'kleva_integration_control' },
      /DATABASE_NAME/,
    ],
    [
      'remote host',
      { KLEVA_TEST_PG_HOST: 'staging.example.test' },
      /KLEVA_TEST_PG_HOST/,
    ],
    ['missing port', { KLEVA_TEST_PG_PORT: undefined }, /KLEVA_TEST_PG_PORT/],
    [
      'missing password',
      { KLEVA_TEST_PG_PASSWORD: undefined },
      /KLEVA_TEST_PG_PASSWORD/,
    ],
  ])('rejects %s before connecting', (_description, overrides, message) => {
    expect(() => integrationConfig({ ...valid, ...overrides })).toThrow(
      message,
    );
  });
});
