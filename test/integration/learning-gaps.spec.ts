import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { KnowledgeGapCaptureService } from '../../src/learning/knowledge-gap-capture.service';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('tenant-scoped AI knowledge gaps', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let primaryTenant: Awaited<ReturnType<typeof seedTenant>>;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
  });

  afterAll(async () => {
    await runtime?.destroy();
    await database?.close();
  });

  it('groups redacted English and Pidgin questions once per AI outcome and keeps tenants separate', async () => {
    const firstTenant = await seedTenant(admin, 1);
    primaryTenant = firstTenant;
    const secondTenant = await seedTenant(admin, 2);
    const capture = new KnowledgeGapCaptureService();

    async function addQuestion(
      tenant: typeof firstTenant,
      question: string,
      reasonCode = 'NO_MATCH',
    ) {
      const inboundId = randomUUID();
      const [message] = await admin.query<{ id: string }[]>(
        `INSERT INTO public.messages
          ("businessId","conversationId",direction,content,status,"whatsappMessageId",metadata)
         VALUES ($1,$2,'inbound',$3,'delivered',$4,'{}') RETURNING id`,
        [tenant.business.id, tenant.conversation.id, question, inboundId],
      );
      const runId = randomUUID();
      await admin.query(
        `INSERT INTO public.ai_response_runs
          (id,business_id,inbound_message_id,conversation_id,authorized_control_version,status,error_category)
         VALUES ($1,$2,$3,$4,1,'HANDOFF_REQUIRED',$5)`,
        [
          runId,
          tenant.business.id,
          message.id,
          tenant.conversation.id,
          reasonCode,
        ],
      );
      const outcome = {
        businessId: tenant.business.id,
        aiRunId: runId,
        inboundMessageId: message.id,
        channel: 'WHATSAPP' as const,
        customerQuestion: question,
        reasonCode,
      };
      const inserted = await runtime.transaction((manager) =>
        capture.capture(manager, outcome),
      );
      return { ...outcome, inserted };
    }

    const a = await addQuestion(firstTenant, 'Can you deliver around Ikeja?');
    const b = await addQuestion(firstTenant, 'Una dey deliver reach Ikeja?');
    const sensitive = await addQuestion(
      firstTenant,
      'Can you deliver to 22 Adeola Odeku Road? Email ada@example.test or call +234 801 234 5678',
    );
    const foreign = await addQuestion(
      secondTenant,
      'Can you deliver around Ikeja?',
    );
    expect(
      a.inserted && b.inserted && sensitive.inserted && foreign.inserted,
    ).toBe(true);

    await runtime.transaction(async (manager) => {
      await expect(
        capture.capture(manager, {
          ...a,
          customerQuestion: 'changed on retry',
        }),
      ).resolves.toBe(false);
    });

    const clusters = await admin.query<
      {
        id: string;
        business_id: string;
        topic_label: string;
        occurrence_count: number;
      }[]
    >(
      `SELECT id,business_id,topic_label,occurrence_count
       FROM public.knowledge_gap_clusters WHERE topic_label='delivery coverage ikeja'
       ORDER BY business_id`,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].business_id).not.toBe(clusters[1].business_id);
    expect(clusters[0].id).not.toBe(clusters[1].id);
    expect(
      clusters.map(({ occurrence_count }) => occurrence_count).sort(),
    ).toEqual([1, 2]);

    const [stored] = await admin.query<{ redacted_question: string }[]>(
      `SELECT redacted_question FROM public.knowledge_gap_occurrences
       WHERE business_id=$1 AND source_ai_run_id=$2`,
      [firstTenant.business.id, sensitive.aiRunId],
    );
    expect(stored.redacted_question).not.toContain('ada@example.test');
    expect(stored.redacted_question).not.toContain('+234 801 234 5678');
    expect(stored.redacted_question).not.toContain('22 Adeola Odeku Road');

    const credentials = await database.merchantCredentials(admin);
    const [acl] = await admin.query<{ can_read: boolean; can_list: boolean }[]>(
      `SELECT has_table_privilege($1,'public.knowledge_gap_occurrences','SELECT') AS can_read,
        has_function_privilege($1,'public.kleva_learning_gaps(integer,text)','EXECUTE') AS can_list`,
      [credentials.username],
    );
    expect(acl).toEqual({ can_read: false, can_list: true });
  });

  it('accepts only actual allowlisted HANDOFF_REQUIRED outcomes and purges expired text', async () => {
    const tenant = primaryTenant;
    const capture = new KnowledgeGapCaptureService();
    const [message] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.messages
        ("businessId","conversationId",direction,content,status,"whatsappMessageId",metadata)
       VALUES ($1,$2,'inbound','Where do you deliver?','delivered',$3,'{}') RETURNING id`,
      [tenant.business.id, tenant.conversation.id, randomUUID()],
    );
    const runId = randomUUID();
    await admin.query(
      `INSERT INTO public.ai_response_runs
        (id,business_id,inbound_message_id,conversation_id,authorized_control_version,status)
       VALUES ($1,$2,$3,$4,1,'QUEUED')`,
      [runId, tenant.business.id, message.id, tenant.conversation.id],
    );
    await expect(
      runtime.transaction((manager) =>
        capture.capture(manager, {
          businessId: tenant.business.id,
          aiRunId: runId,
          inboundMessageId: message.id,
          channel: 'WHATSAPP',
          customerQuestion: 'Where do you deliver?',
          reasonCode: 'NO_MATCH',
        }),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });

    await admin.query(
      `UPDATE public.ai_response_runs SET status='HANDOFF_REQUIRED',error_category='NO_MATCH' WHERE id=$1`,
      [runId],
    );
    const captureOutcome = {
      businessId: tenant.business.id,
      aiRunId: runId,
      inboundMessageId: message.id,
      channel: 'WHATSAPP' as const,
      customerQuestion: 'Where do you deliver?',
      reasonCode: 'NO_MATCH',
    };
    await runtime.transaction((manager) =>
      capture.capture(manager, captureOutcome),
    );
    const [captured] = await admin.query<{ cluster_id: string }[]>(
      `SELECT cluster_id FROM public.knowledge_gap_occurrences
       WHERE business_id=$1 AND source_ai_run_id=$2`,
      [tenant.business.id, runId],
    );
    await admin.query(
      `UPDATE public.knowledge_gap_occurrences SET
         occurred_at=now()-interval '2 seconds',expires_at=now()-interval '1 second'
       WHERE business_id=$1 AND source_ai_run_id=$2`,
      [tenant.business.id, runId],
    );
    const [purged] = await runtime.query<{ removed: number }[]>(
      'SELECT public.kleva_learning_gap_purge_expired() AS removed',
    );
    expect(Number(purged.removed)).toBe(1);
    const [cluster] = await admin.query<{ occurrence_count: number }[]>(
      'SELECT occurrence_count FROM public.knowledge_gap_clusters WHERE business_id=$1 AND id=$2',
      [tenant.business.id, captured.cluster_id],
    );
    expect(cluster.occurrence_count).toBe(1);
    const [expiredSample] = await admin.query<
      { redacted_question: string | null }[]
    >(
      `SELECT redacted_question FROM public.knowledge_gap_occurrences
       WHERE business_id=$1 AND source_ai_run_id=$2`,
      [tenant.business.id, runId],
    );
    expect(expiredSample).toBeUndefined();
  });
});
