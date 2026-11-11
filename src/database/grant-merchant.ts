import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options';
import { grantMerchantAccess } from './merchant-access';
import { identityRolePattern, merchantRolePattern } from '../config/env';

async function grant() {
  const role = process.env.MERCHANT_DATABASE_USER?.trim();
  const identityRole = process.env.IDENTITY_DATABASE_USER?.trim();
  if (
    !role ||
    !identityRole ||
    !merchantRolePattern.test(role) ||
    !identityRolePattern.test(identityRole)
  ) {
    console.error(
      'Set MERCHANT_DATABASE_USER and IDENTITY_DATABASE_USER to the provisioned logins.',
    );
    process.exitCode = 1;
    return;
  }
  try {
    const source = new DataSource(databaseOptions());
    await source.initialize();
    try {
      await grantMerchantAccess(source, role, identityRole);
      console.log('Merchant database permissions applied.');
    } finally {
      await source.destroy();
    }
  } catch {
    console.error(
      'Merchant grant failed. Check the migration-owner connection, schema and merchant login.',
    );
    process.exitCode = 1;
  }
}
void grant();
