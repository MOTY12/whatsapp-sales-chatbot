import { randomBytes } from 'node:crypto';
import { grantMerchantAccess } from '../../src/database/merchant-access';
import { databaseConfig } from '../../src/config/env';
import { DataSource, Migration } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import {
  databaseEntities,
  databaseMigrations,
} from '../../src/database/schema';

const controlDatabase = 'kleva_integration_control';
const databasePrefix = 'kleva_integration_';

export function integrationConfig(
  env: NodeJS.ProcessEnv,
): PostgresConnectionOptions {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('PostgreSQL integration tests reject NODE_ENV=production.');
  }
  if (env.DATABASE_NAME?.trim().toLowerCase().startsWith(databasePrefix)) {
    throw new Error('DATABASE_NAME must not point to an integration database.');
  }

  const host = env.KLEVA_TEST_PG_HOST;
  const port = Number(env.KLEVA_TEST_PG_PORT);
  const username = env.KLEVA_TEST_PG_USER;
  const password = env.KLEVA_TEST_PG_PASSWORD;
  if (env.KLEVA_TEST_PG_DATABASE !== controlDatabase) {
    throw new Error(`Set KLEVA_TEST_PG_DATABASE to ${controlDatabase}.`);
  }
  if (host !== '127.0.0.1' && !host?.startsWith('/')) {
    throw new Error(
      'KLEVA_TEST_PG_HOST must be 127.0.0.1 or a Unix socket directory.',
    );
  }
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !username?.trim() ||
    !password?.trim()
  ) {
    throw new Error(
      'Set KLEVA_TEST_PG_PORT, KLEVA_TEST_PG_USER and KLEVA_TEST_PG_PASSWORD.',
    );
  }
  return {
    ...databaseConfig({
      NODE_ENV: 'test',
      DATABASE_HOST: host,
      DATABASE_PORT: String(port),
      DATABASE_USER: username,
      DATABASE_PASSWORD: password,
      DATABASE_NAME: controlDatabase,
    }),
    installExtensions: false,
  };
}

export async function createIntegrationDatabase() {
  const config = integrationConfig(process.env);
  const suffix = randomBytes(8).toString('hex');
  const database = databasePrefix + suffix;
  const migrationRole = 'kleva_migration_' + suffix;
  const runtimeRole = 'kleva_runtime_' + suffix;
  const migrationPassword = randomBytes(24).toString('hex');
  const runtimePassword = randomBytes(24).toString('hex');
  const control = new DataSource(config);
  const connections: DataSource[] = [];
  let createdDatabase = false;
  let createdMigrationRole = false;
  let createdRuntimeRole = false;
  const merchantRoles: string[] = [];

  async function close() {
    const cleanupErrors: unknown[] = [];
    async function attempt(cleanup: () => Promise<unknown>) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    for (const source of connections.reverse()) {
      if (source.isInitialized) {
        await attempt(() => source.destroy());
      }
    }
    if (control.isInitialized) {
      if (createdDatabase) {
        await attempt(() =>
          control.query(`DROP DATABASE "${database}" WITH (FORCE)`),
        );
      }
      for (const role of merchantRoles) {
        await attempt(() => control.query(`DROP ROLE "${role}"`));
      }
      if (createdRuntimeRole) {
        await attempt(() => control.query(`DROP ROLE "${runtimeRole}"`));
      }
      if (createdMigrationRole) {
        await attempt(() => control.query(`DROP ROLE "${migrationRole}"`));
      }
      await attempt(() => control.destroy());
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, `Could not clean up ${database}`);
    }
  }

  async function connect(
    options: Pick<
      PostgresConnectionOptions,
      'username' | 'password' | 'entities' | 'migrations'
    >,
  ) {
    const source = new DataSource({
      ...config,
      ...options,
      database,
      schema: 'public',
    });
    connections.push(source);
    return source.initialize();
  }

  try {
    await control.initialize();
    const [connection] = await control.query<{ database: string }[]>(
      'SELECT current_database() AS database',
    );
    if (connection.database !== controlDatabase) {
      throw new Error(
        'Connected to the wrong PostgreSQL integration control database.',
      );
    }
    // Names and role passwords interpolated below are generated locally from hex.
    await control.query(
      `CREATE ROLE "${migrationRole}" LOGIN PASSWORD '${migrationPassword}'`,
    );
    createdMigrationRole = true;
    await control.query(
      `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'`,
    );
    createdRuntimeRole = true;
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    createdDatabase = true;
    await control.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    await control.query(
      `GRANT CONNECT, CREATE ON DATABASE "${database}" TO "${migrationRole}"`,
    );
    await control.query(
      `GRANT CONNECT ON DATABASE "${database}" TO "${runtimeRole}"`,
    );

    const admin = await connect({});
    await admin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await admin.query(
      `GRANT USAGE, CREATE ON SCHEMA public TO "${migrationRole}"`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await admin.destroy();

    return {
      close,
      async migrator(migrations = databaseMigrations) {
        return connect({
          username: migrationRole,
          password: migrationPassword,
          entities: databaseEntities,
          migrations,
        });
      },
      async runtime() {
        return connect({
          username: runtimeRole,
          password: runtimePassword,
          entities: databaseEntities,
        });
      },
      async merchantCredentials(migrator: DataSource) {
        const username = 'kleva_merchant_' + suffix;
        const identityUsername = 'kleva_identity_' + suffix;
        const password = randomBytes(24).toString('hex');
        const identityPassword = randomBytes(24).toString('hex');
        const admin = await connect({});
        try {
          for (const [role, secret] of [
            [username, password],
            [identityUsername, identityPassword],
          ]) {
            await control.query(
              `CREATE ROLE "${role}" LOGIN PASSWORD '${secret}'`,
            );
            merchantRoles.push(role);
            await control.query(
              `GRANT CONNECT ON DATABASE "${database}" TO "${role}"`,
            );
            await admin.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
          }
        } finally {
          await admin.destroy();
        }
        await grantMerchantAccess(migrator, username, identityUsername);
        return {
          host: config.host,
          port: config.port,
          database,
          username,
          password,
          identityUsername,
          identityPassword,
        };
      },
      async grantRuntimeAccess(migrator: DataSource) {
        const names = migrator.entityMetadatas.map(
          ({ tableName }) => `public."${tableName}"`,
        );
        const [credentialTable] = await migrator.query<{ exists: boolean }[]>(
          "SELECT to_regclass('public.whatsapp_credentials') IS NOT NULL AS exists",
        );
        const [receiptTable] = await migrator.query<{ exists: boolean }[]>(
          "SELECT to_regclass('public.webhook_receipts') IS NOT NULL AS exists",
        );
        if (receiptTable.exists) {
          await migrator.query(
            `GRANT SELECT, INSERT, UPDATE (handed_off_at) ON public.webhook_receipts TO "${runtimeRole}"`,
          );
        }
        if (credentialTable.exists) {
          await migrator.query(
            `GRANT SELECT, UPDATE (expires_at, revision) ON public.whatsapp_credentials TO "${runtimeRole}"`,
          );
        }
        await migrator.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ${names.join(', ')} TO "${runtimeRole}"`,
        );
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'PostgreSQL integration setup and cleanup failed',
      );
    }
    throw error;
  }
}

export async function applyMigrations(
  source: DataSource,
): Promise<Migration[]> {
  try {
    return await source.runMigrations();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Migration failed in ${source.driver.database ?? 'integration database'}: ${detail}`,
      { cause: error },
    );
  }
}
