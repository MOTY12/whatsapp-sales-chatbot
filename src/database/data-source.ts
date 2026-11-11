import 'dotenv/config';
import { DataSource } from 'typeorm';
import { errorCode } from '../config/logging';
import { databaseOptions } from './options';
import { databaseMigrations } from './schema';

// The stock CLI prints thrown errors directly. Driver and migration errors
// can contain SQL, credential values or customer data.
class MigrationDataSource extends DataSource {
  private async report<T>(operation: string, execute: () => Promise<T>) {
    try {
      return await execute();
    } catch (error) {
      const code = errorCode(error);
      throw new Error(
        code ? `${operation} failed (${code}).` : `${operation} failed.`,
      );
    }
  }

  override initialize() {
    return this.report('PostgreSQL connection', () => super.initialize());
  }

  override runMigrations(options?: Parameters<DataSource['runMigrations']>[0]) {
    return this.report('Migration apply', () => super.runMigrations(options));
  }

  override undoLastMigration(
    options?: Parameters<DataSource['undoLastMigration']>[0],
  ) {
    return this.report('Migration revert', () =>
      super.undoLastMigration(options),
    );
  }

  override showMigrations() {
    return this.report('Migration status', () => super.showMigrations());
  }
}

export default new MigrationDataSource({
  ...databaseOptions(),
  migrations: databaseMigrations,
});
