export const tenantLinks = [
  {
    child: 'customers',
    column: 'ownerId',
    parent: 'users',
    onDelete: 'SET NULL ("ownerId")',
  },
  {
    child: 'conversations',
    column: 'customerId',
    parent: 'customers',
    onDelete: 'CASCADE',
  },
  {
    child: 'messages',
    column: 'conversationId',
    parent: 'conversations',
    onDelete: 'CASCADE',
  },
  {
    child: 'follow_ups',
    column: 'customerId',
    parent: 'customers',
    onDelete: 'CASCADE',
  },
  {
    child: 'follow_ups',
    column: 'ownerId',
    parent: 'users',
    onDelete: 'SET NULL ("ownerId")',
  },
  {
    child: 'tasks',
    column: 'ownerId',
    parent: 'users',
    onDelete: 'SET NULL ("ownerId")',
  },
  {
    child: 'audit_logs',
    column: 'userId',
    parent: 'users',
    onDelete: 'SET NULL ("userId")',
  },
  {
    child: 'sales',
    column: 'customerId',
    parent: 'customers',
    onDelete: 'SET NULL ("customerId")',
  },
  {
    child: 'sales',
    column: 'ownerId',
    parent: 'users',
    onDelete: 'SET NULL ("ownerId")',
  },
  {
    child: 'assistant_sessions',
    column: 'ownerId',
    parent: 'users',
    onDelete: 'CASCADE',
  },
  {
    child: 'onboarding_sessions',
    column: 'ownerId',
    parent: 'users',
    onDelete: 'SET NULL ("ownerId")',
  },
] as const;

export const tenantTables = [
  'assistant_sessions',
  'audit_logs',
  'conversations',
  'customers',
  'follow_ups',
  'messages',
  'notifications',
  'onboarding_sessions',
  'outbox_operations',
  'pipeline_stages',
  'sales',
  'tasks',
  'users',
] as const;

export const newBusinessLinks = [
  'messages',
  'notifications',
  'onboarding_sessions',
  'pipeline_stages',
] as const;

export interface TenantFinding {
  issue: string;
  count: number;
  blocking: boolean;
}

export class TenantIntegrityError extends Error {
  constructor(findings: TenantFinding[]) {
    super(
      `Tenant integrity preflight blocked migration. Run npm run tenant:preflight for counts. Blocking groups: ${findings.filter(({ blocking }) => blocking).length}.`,
    );
  }
}

export async function inspectTenantIntegrity(source: {
  query(sql: string): Promise<unknown>;
}): Promise<TenantFinding[]> {
  const businessChecks = tenantTables.map(
    (table) => `
    SELECT '${table}.businessId.missing_or_invalid' AS issue, true AS blocking
    FROM ${table} c LEFT JOIN businesses b
      ON b.id = CASE WHEN pg_input_is_valid(c."businessId"::text, 'uuid') THEN c."businessId"::uuid END
    WHERE c."businessId" IS NOT NULL AND b.id IS NULL
  `,
  );
  const parentChecks = tenantLinks.map(
    ({ child, column, parent }) => `
    SELECT '${child}.${column}.' || CASE WHEN p.id IS NULL THEN 'missing_or_invalid' ELSE 'cross_tenant' END AS issue,
      true AS blocking
    FROM ${child} c LEFT JOIN ${parent} p
      ON p.id = CASE WHEN pg_input_is_valid(c."${column}"::text, 'uuid') THEN c."${column}"::uuid END
    WHERE c."${column}" IS NOT NULL AND (
      p.id IS NULL OR p."businessId" IS DISTINCT FROM
        CASE WHEN pg_input_is_valid(c."businessId"::text, 'uuid') THEN c."businessId"::uuid END
    )
  `,
  );

  return (await source.query(`
    SELECT issue, count(*)::int AS count, blocking FROM (
      ${[...businessChecks, ...parentChecks].join(' UNION ALL ')}
      UNION ALL
      SELECT 'businesses.multiple_active_legacy_owners', true
      FROM users WHERE status = 'active' AND 'owner' = ANY(string_to_array(roles, ','))
      GROUP BY "businessId" HAVING count(*) > 1
      UNION ALL
      SELECT 'businesses.unresolved_owner_hint', true
      FROM businesses b WHERE NULLIF(b.config->>'ownerWhatsappId', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u WHERE u."businessId" = b.id
          AND u."whatsappId" = b.config->>'ownerWhatsappId'
          AND 'owner' = ANY(string_to_array(u.roles, ','))
      )
      UNION ALL
      SELECT 'onboarding_sessions.owner_sender_mismatch', true
      FROM onboarding_sessions s JOIN users u
        ON u.id = CASE WHEN pg_input_is_valid(s."ownerId"::text, 'uuid') THEN s."ownerId"::uuid END
      WHERE u."whatsappId" IS NOT NULL AND u."whatsappId" <> s."whatsappId"
      UNION ALL
      SELECT 'conversations.multiple_open_threads', false
      FROM conversations WHERE status = 'open'
      GROUP BY "businessId", "customerId" HAVING count(*) > 1
    ) findings GROUP BY issue, blocking ORDER BY issue
  `)) as TenantFinding[];
}
