import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options';
import { errorCode } from '../config/logging';
import { inspectTenantIntegrity } from './tenant-integrity';

async function report() {
  try {
    const source = new DataSource(databaseOptions());
    await source.initialize();
    try {
      const findings = await inspectTenantIntegrity(source);
      console.log(JSON.stringify({ findings }, null, 2));
      if (findings.some(({ blocking }) => blocking)) process.exitCode = 1;
    } finally {
      await source.destroy();
    }
  } catch (error) {
    const code = errorCode(error);
    console.error(
      code
        ? `Tenant preflight failed (${code}).`
        : 'Tenant preflight failed. Check the database settings and prerequisite migrations.',
    );
    process.exitCode = 1;
  }
}

void report();
