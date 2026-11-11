import type { DataSource } from 'typeorm';
import { tenantTables } from './tenant-integrity';

import { identityRolePattern, merchantRolePattern } from '../config/env';
export const merchantPolicyTables = [
  ...tenantTables,
  'businesses',
  'business_members',
  'accounts',
  'merchant_sessions',
  'merchant_login_attempts',
];

const identityFunctions = [
  'kleva_consume_login(text,text)',
  'kleva_issue_session(text,text,text,text,text)',
];
const sessionFunctions = [
  'kleva_session_account(text,text)',
  'kleva_revoke_session(text,text)',
  'kleva_list_memberships(text)',
];
export const policyFunctions = [
  'kleva_current_account()',
  'kleva_current_role()',
];
export const merchantFunctions = [
  ...identityFunctions,
  ...sessionFunctions,
  ...policyFunctions,
];

export async function grantMerchantAccess(
  source: DataSource,
  role: string,
  identityRole: string,
) {
  if (
    !merchantRolePattern.test(role) ||
    !identityRolePattern.test(identityRole)
  ) {
    throw new Error('Invalid merchant or identity database role name.');
  }
  await source.transaction(async (manager) => {
    await manager.query(
      `GRANT INSERT ON public.merchant_login_attempts TO "${identityRole}"`,
    );
    await manager.query(
      `GRANT SELECT (id, name, status) ON public.businesses TO "${role}"`,
    );
    await manager.query(
      `GRANT SELECT ("businessId", "accountId", role, status) ON public.business_members TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${sessionFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${identityFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${identityRole}"`,
    );
  });
}
