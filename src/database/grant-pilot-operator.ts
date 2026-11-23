import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options';

const rolePattern = /^kleva_pilot_operator_[a-z0-9_]{1,40}$/;

async function grant() {
  const role = process.env.PILOT_OPERATOR_DATABASE_USER?.trim();
  if (!role || !rolePattern.test(role)) {
    console.error(
      'Set PILOT_OPERATOR_DATABASE_USER to an individually provisioned kleva_pilot_operator_<name> database role.',
    );
    process.exitCode = 1;
    return;
  }
  const source = new DataSource(databaseOptions());
  try {
    await source.initialize();
    await source.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await source.query(
      `GRANT EXECUTE ON FUNCTION public.kleva_pilot_activate(uuid,text,integer,integer,integer,integer) TO "${role}"`,
    );
    console.log('Pilot operator may execute the scoped activation function.');
  } catch {
    console.error(
      'Pilot operator grant failed. Check the migration-owner connection, role, and completed migrations.',
    );
    process.exitCode = 1;
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

void grant();
