import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { merchantAuthConfig } from '../config/env';
import {
  databaseLogger,
  errorCode,
  postgresErrorCategory,
} from '../config/logging';
import { merchantPolicyTables } from '../database/merchant-access';

export const MERCHANT_AUTH_CONFIG = Symbol('MERCHANT_AUTH_CONFIG');
export type MerchantAuthConfig = ReturnType<typeof merchantAuthConfig>;

@Injectable()
export class MerchantDatabase implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MerchantDatabase.name);
  private source?: DataSource;
  private identity?: DataSource;

  constructor(
    @Inject(MERCHANT_AUTH_CONFIG) private readonly config: MerchantAuthConfig,
  ) {}

  async onModuleInit() {
    if (!this.config) return;
    try {
      this.source = await this.open(this.config.database, false);
      this.identity = await this.open(this.config.identityDatabase, true);
    } catch {
      await this.source?.destroy();
      this.source = undefined;
      throw new Error(
        'Merchant database initialization failed. Check both restricted roles, migration and grants.',
      );
    }
  }

  private async open(
    options: NonNullable<MerchantAuthConfig>['database'],
    identity: boolean,
  ) {
    let stage: 'connection' | 'role_validation' = 'connection';
    let failureCategory: string | undefined;
    const source = new DataSource({
      ...options,
      poolSize: 4,
      installExtensions: false,
      logger: databaseLogger(false),
    });
    try {
      await source.initialize();
      stage = 'role_validation';
      const [result] = await source.query<{ restricted: boolean }[]>(
        `
        SELECT current_user = $1 AND session_user = current_user
          AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
          AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
          AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba = r.oid)
          AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = r.oid)
          AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
          AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
          AND (
            SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname::text = ANY($2)
              AND c.relrowsecurity AND c.relforcerowsecurity
          ) = cardinality($2::text[])
          AND has_function_privilege(current_user, 'public.kleva_issue_session(text,text,text,text,text)', 'EXECUTE') = $3
          AND has_function_privilege(current_user, 'public.kleva_session_account(text,text)', 'EXECUTE') <> $3
          AS restricted
        FROM pg_roles r WHERE r.rolname = current_user
      `,
        [options.username, merchantPolicyTables, identity],
      );
      if (!result?.restricted) {
        failureCategory = 'role_policy_check_failed';
        throw new Error('Merchant database role policy check failed.');
      }
      return source;
    } catch (error) {
      const code = errorCode(error) ?? nestedDatabaseErrorCode(error);
      this.logger.error({
        event: 'merchant_database.initialization_failed',
        role: identity ? 'identity' : 'merchant',
        stage,
        category:
          failureCategory ??
          (stage === 'connection'
            ? 'database_connection_failed'
            : 'role_policy_query_failed'),
        ...(code ? { databaseErrorCode: code } : {}),
        ...(code ? { databaseCategory: postgresErrorCategory({ code }) } : {}),
      });
      if (source.isInitialized) await source.destroy();
      throw new Error('Merchant database role initialization failed.');
    }
  }

  connection(): DataSource {
    if (!this.source)
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    return this.source;
  }

  identityConnection(): DataSource {
    if (!this.identity)
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    return this.identity;
  }

  async onApplicationShutdown() {
    await Promise.all([this.source?.destroy(), this.identity?.destroy()]);
  }
}

function nestedDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('driverError' in error))
    return undefined;
  return errorCode(error.driverError);
}
