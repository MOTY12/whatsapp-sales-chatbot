import 'dotenv/config';
import dataSource from './data-source';
import { errorCode } from '../config/logging';

const lockName = 'kleva:postgres:migrations:v1';

async function runMigrations() {
  await dataSource.initialize();
  const lock = dataSource.createQueryRunner();
  let connected = false;
  let acquired = false;
  try {
    await lock.connect();
    connected = true;
    await lock.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
      lockName,
    ]);
    acquired = true;
    const pending = await dataSource.showMigrations();
    if (!pending) {
      console.log('No migrations are pending.');
      return;
    }
    await dataSource.runMigrations({ transaction: 'all' });
  } finally {
    try {
      if (acquired) {
        await lock
          .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
            lockName,
          ])
          .catch(() => undefined);
      }
      if (connected) await lock.release();
    } finally {
      if (dataSource.isInitialized) await dataSource.destroy();
    }
  }
}

void runMigrations().catch((error: unknown) => {
  const code = errorCode(error);
  console.error(
    code ? `Migration runner failed (${code}).` : 'Migration runner failed.',
  );
  process.exitCode = 1;
});
