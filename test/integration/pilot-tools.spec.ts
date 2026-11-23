import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { Account } from '../../src/database/entities/account.entity';
import { AgentToolExecutor } from '../../src/agent-tools/agent-tool-executor.service';
import { merchantPolicyTables } from '../../src/database/merchant-access';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { seedTenant } from './fixtures';

describe('controlled pilot agent tools', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let executor: AgentToolExecutor;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;
  let actorId: string;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    first = await seedTenant(admin, 1);
    second = await seedTenant(admin, 2);
    actorId = (
      await admin.getRepository(Account).save({
        issuer: 'https://tools.integration.test',
        subject: randomUUID(),
      })
    ).id;
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    executor = new AgentToolExecutor(runtime);
  });

  afterAll(async () => {
    await runtime?.destroy();
    await database?.close();
  });

  async function product(businessId: string, name: string, published: boolean) {
    const [created] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_products(business_id,creation_key,creation_fingerprint,created_by,updated_by)
       VALUES($1,$2,$3,$4,$4) RETURNING id`,
      [businessId, randomUUID(), randomUUID(), actorId],
    );
    const revisionId = randomUUID();
    await admin.query(
      `INSERT INTO public.merchant_product_revisions(id,business_id,product_id,revision,name,description,sku,price,currency,availability,created_by)
       VALUES($1,$2,$3,1,$4,'Published catalog fixture',NULL,'300000.00','NGN','IN_STOCK',$5)`,
      [revisionId, businessId, created.id, name, actorId],
    );
    await admin.query(
      `UPDATE public.merchant_products SET draft_revision_id=$3,
        published_revision_id=$4,published_at=CASE WHEN $4::uuid IS NULL THEN NULL ELSE now() END
       WHERE business_id=$1 AND id=$2`,
      [businessId, created.id, revisionId, published ? revisionId : null],
    );
    return { productId: created.id, revisionId };
  }

  async function leadAndRun(tenant: typeof first, message: string) {
    const [lead] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_leads(business_id,customer_id,conversation_id,source,status,first_contact_at,last_activity_at)
       VALUES($1,$2,$3,'WHATSAPP','NEW',now(),now())
       ON CONFLICT (business_id,conversation_id) DO UPDATE SET last_activity_at=now()
       RETURNING id`,
      [tenant.business.id, tenant.customer.id, tenant.conversation.id],
    );
    const inboundMessageId = randomUUID();
    await admin.query(
      `INSERT INTO public.messages(id,"businessId","conversationId",direction,content,status,"whatsappMessageId")
       VALUES($1,$2,$3,'inbound',$4,'received',$5)`,
      [
        inboundMessageId,
        tenant.business.id,
        tenant.conversation.id,
        message,
        `tool-fixture-${inboundMessageId}`,
      ],
    );
    const [conversation] = await admin.query<{ control_version: string }[]>(
      'SELECT control_version FROM public.conversations WHERE id=$1 AND "businessId"=$2',
      [tenant.conversation.id, tenant.business.id],
    );
    const runId = randomUUID();
    await admin.query(
      `INSERT INTO public.ai_response_runs(id,business_id,inbound_message_id,conversation_id,lead_id,authorized_control_version)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        runId,
        tenant.business.id,
        inboundMessageId,
        tenant.conversation.id,
        lead.id,
        conversation.control_version,
      ],
    );
    return {
      leadId: lead.id,
      inboundMessageId,
      runId,
      controlVersion: Number(conversation.control_version),
    };
  }

  it('searches only published active-tenant offers and preserves exact price and revision evidence', async () => {
    const published = await product(first.business.id, 'Samsung A15', true);
    await product(first.business.id, 'Samsung A15 draft', false);
    await product(second.business.id, 'Samsung A15 other tenant', true);
    const run = await leadAndRun(first, 'How much is the Samsung A15?');
    const result = await executor.execute(
      {
        name: 'search_published_offers',
        version: 1,
        arguments: { query: 'Samsung A15' },
      },
      {
        businessId: first.business.id,
        conversationId: first.conversation.id,
        aiRunId: run.runId,
        leadId: run.leadId,
        customerMessage: 'How much is the Samsung A15?',
      },
    );
    expect(result.result.offers).toEqual([
      expect.objectContaining({
        productId: published.productId,
        revisionId: published.revisionId,
        price: '300000.00',
        currency: 'NGN',
      }),
    ]);
    const replay = await executor.execute(
      {
        name: 'search_published_offers',
        version: 1,
        arguments: { query: 'Samsung A15' },
      },
      {
        businessId: first.business.id,
        conversationId: first.conversation.id,
        aiRunId: run.runId,
        leadId: run.leadId,
        customerMessage: 'How much is the Samsung A15?',
      },
    );
    expect(replay.result).toEqual(result.result);
    const [ledger] = await admin.query<{ count: string }[]>(
      'SELECT count(*)::text AS count FROM public.agent_tool_executions WHERE ai_run_id=$1',
      [run.runId],
    );
    expect(ledger.count).toBe('1');
    await expect(
      executor.execute(
        {
          name: 'search_published_offers',
          version: 1,
          arguments: { query: 'other query' },
        },
        {
          businessId: second.business.id,
          conversationId: first.conversation.id,
          aiRunId: run.runId,
          leadId: run.leadId,
          customerMessage: 'How much is the Samsung A15?',
        },
      ),
    ).rejects.toBeDefined();
  });

  it('writes quote-backed in-progress qualification once, reports missing fields and blocks consent-required values', async () => {
    const run = await leadAndRun(
      first,
      'I need three units. I agree to follow-up.',
    );
    const policyFields = [
      {
        id: 'product_interest',
        label: 'Product interest',
        type: 'TEXT',
        required: true,
        validation: { maxLength: 120 },
        consentRequired: false,
        order: 10,
        purpose: 'What the customer needs',
      },
      {
        id: 'quantity',
        label: 'Quantity',
        type: 'NUMBER',
        required: false,
        validation: { min: 1, max: 20 },
        consentRequired: false,
        order: 20,
        purpose: 'Number requested',
      },
      {
        id: 'contact_ok',
        label: 'Follow-up permission',
        type: 'BOOLEAN',
        required: false,
        validation: {},
        consentRequired: true,
        order: 30,
        purpose: 'Permission for follow-up',
      },
    ];
    await admin.query(
      'INSERT INTO public.sales_qualification_policies(business_id,version,fields,changed_by) VALUES($1,1,$2::jsonb,$3)',
      [first.business.id, JSON.stringify(policyFields), actorId],
    );
    const args = {
      name: 'record_lead_qualification',
      version: 1,
      arguments: {
        fieldValues: {
          quantity: { value: 3, sourceQuote: 'three units' },
          contact_ok: { value: true, sourceQuote: 'I agree to follow-up' },
        },
      },
    };
    const context = {
      businessId: first.business.id,
      conversationId: first.conversation.id,
      aiRunId: run.runId,
      leadId: run.leadId,
      customerMessage: 'I need three units. I agree to follow-up.',
    };
    const result = await executor.execute(args, context);
    expect(result.classification).toBe('CONSENT_REQUIRED');
    expect(result.result).toMatchObject({
      storedFieldIds: ['quantity'],
      missingFieldIds: ['product_interest'],
      consentRequiredFieldIds: ['contact_ok'],
    });
    const replay = await executor.execute(args, context);
    expect(replay.result).toEqual(result.result);
    const [stored] = await admin.query<{ status: string; version: string }[]>(
      `SELECT l.status,l.version FROM public.merchant_leads l WHERE l.id=$1 AND l.business_id=$2`,
      [run.leadId, first.business.id],
    );
    expect(stored).toMatchObject({ status: 'NEW', version: '2' });
    const [snapshot] = await admin.query<
      {
        field_values: Record<string, unknown>;
        consent_evidence: Record<string, unknown>;
        source_kind: string;
      }[]
    >(
      'SELECT field_values,consent_evidence,source_kind FROM public.merchant_lead_qualifications WHERE lead_id=$1',
      [run.leadId],
    );
    expect(snapshot).toMatchObject({
      field_values: { quantity: 3 },
      consent_evidence: {},
      source_kind: 'AI',
    });
    expect(snapshot.field_values).not.toHaveProperty('contact_ok');
  });

  it('hands off once, switches to HUMAN and preserves the control-version fence', async () => {
    const run = await leadAndRun(first, 'Please let me talk to a human.');
    const tool = {
      name: 'request_human_handoff',
      version: 1,
      arguments: { reasonCode: 'CUSTOMER_REQUEST' },
    };
    const context = {
      businessId: first.business.id,
      conversationId: first.conversation.id,
      aiRunId: run.runId,
      leadId: run.leadId,
      customerMessage: 'Please let me talk to a human.',
    };
    const result = await executor.execute(tool, context);
    expect(result.classification).toBe('HANDOFF');
    expect(result.result).toMatchObject({
      reasonCode: 'CUSTOMER_REQUEST',
      controlVersion: run.controlVersion + 1,
    });
    const replay = await executor.execute(tool, context);
    expect(replay.result).toEqual(result.result);
    const [conversation] = await admin.query<
      { control_mode: string; control_version: string }[]
    >(
      'SELECT control_mode,control_version FROM public.conversations WHERE id=$1',
      [first.conversation.id],
    );
    expect(conversation).toMatchObject({
      control_mode: 'HUMAN',
      control_version: String(run.controlVersion + 1),
    });
    const [audit] = await admin.query<{ count: string }[]>(
      'SELECT count(*)::text AS count FROM public.agent_tool_handoff_events WHERE ai_run_id=$1',
      [run.runId],
    );
    expect(audit.count).toBe('1');
  });

  it('keeps the execution ledger invisible to restricted merchant roles', async () => {
    const credentials = await database.merchantCredentials(admin);
    const roles = merchantPolicyTables;
    expect(roles).toContain('agent_tool_executions');
    expect(roles).toContain('agent_tool_handoff_events');
    const [policy] = await admin.query<
      { enabled: boolean; forced: boolean; granted: boolean }[]
    >(
      `SELECT c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
        has_table_privilege($1,'public.agent_tool_executions','SELECT') AS granted
       FROM pg_class c WHERE c.oid='public.agent_tool_executions'::regclass`,
      [credentials.username],
    );
    expect(policy).toMatchObject({
      enabled: true,
      forced: true,
      granted: false,
    });
  });
});
