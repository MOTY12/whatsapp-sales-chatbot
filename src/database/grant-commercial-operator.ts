import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options';

const rolePattern = /^kleva_commercial_operator_[a-z0-9_]{1,40}$/;
const requiredGroups = [
  'kleva_commercial_package_manager',
  'kleva_commercial_enrollment_manager',
  'kleva_commercial_invoice_manager',
  'kleva_commercial_payment_recorder',
  'kleva_commercial_payment_confirmer',
  'kleva_commercial_entitlement_manager',
  'kleva_commercial_capacity_manager',
];

async function grant() {
  const role = process.env.COMMERCIAL_OPERATOR_DATABASE_USER?.trim();
  if (!role || !rolePattern.test(role)) {
    console.error(
      'Set COMMERCIAL_OPERATOR_DATABASE_USER to an individually provisioned kleva_commercial_operator_<name> login.',
    );
    process.exitCode = 1;
    return;
  }
  const source = new DataSource(databaseOptions());
  try {
    await source.initialize();
    const memberships = await source.query<
      { group_name: string; allowed: boolean; inherits: boolean }[]
    >(
      `SELECT groups.group_name,pg_has_role($1,groups.group_name,'member') AS allowed,role.rolinherit AS inherits
       FROM unnest($2::text[]) AS groups(group_name) CROSS JOIN pg_roles role
       WHERE role.rolname=$1 ORDER BY groups.group_name`,
      [role, requiredGroups],
    );
    if (
      !memberships.some(({ allowed }) => allowed) ||
      (memberships.some(({ allowed }) => allowed) &&
        memberships[0]?.inherits !== true)
    ) {
      throw new Error(
        'Commercial operator needs an inheriting commercial permission group.',
      );
    }
    await source.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    const allowedGroups = memberships
      .filter(({ allowed }) => allowed)
      .map(({ group_name }) => group_name);
    console.log(
      JSON.stringify({
        event: 'commercial.operator_permissions.verified',
        operatorRole: role,
        permissions: allowedGroups,
      }),
    );
  } catch {
    console.error(
      'Commercial operator grant failed. Check role membership, migration state, and the migration database credentials.',
    );
    process.exitCode = 1;
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

void grant();
