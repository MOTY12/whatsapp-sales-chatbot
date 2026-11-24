import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  classifyKnowledgeGapReason,
  normalizeKnowledgeTopic,
  redactKnowledgeQuestion,
  stableKnowledgeGapId,
} from './knowledge-gap-normalization';

export type KnowledgeGapOutcome = {
  businessId: string;
  aiRunId: string;
  inboundMessageId: string;
  channel: 'WHATSAPP' | 'WEBSITE';
  customerQuestion: string;
  reasonCode: string | null;
};

/** Writes only redacted, allowlisted outcomes, in the AI run's transaction. */
@Injectable()
export class KnowledgeGapCaptureService {
  private readonly logger = new Logger(KnowledgeGapCaptureService.name);

  async capture(
    manager: EntityManager,
    outcome: KnowledgeGapOutcome,
  ): Promise<boolean> {
    const classified = classifyKnowledgeGapReason(outcome.reasonCode);
    if (!classified) return false;
    const safeQuestion = redactKnowledgeQuestion(outcome.customerQuestion);
    const normalizedTopic = normalizeKnowledgeTopic(
      safeQuestion,
      classified.category,
    );
    const { id: clusterId, key: clusterKey } = stableKnowledgeGapId(
      outcome.businessId,
      classified.category,
      normalizedTopic,
    );

    const [cluster] = await manager.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_gap_clusters
         (id,business_id,cluster_key,category,normalized_topic,topic_label,last_reason_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (business_id,cluster_key) DO NOTHING
       RETURNING id`,
      [
        clusterId,
        outcome.businessId,
        clusterKey,
        classified.category,
        normalizedTopic,
        normalizedTopic.slice(0, 120),
        classified.reason,
      ],
    );
    const existingCluster = cluster?.id
      ? cluster
      : (
          await manager.query<{ id: string }[]>(
            `SELECT id FROM public.knowledge_gap_clusters
              WHERE business_id=$1 AND cluster_key=$2`,
            [outcome.businessId, clusterKey],
          )
        )[0];
    if (!existingCluster?.id) return false;

    const [occurrence] = await manager.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_gap_occurrences
         (business_id,cluster_id,source_ai_run_id,origin_reference,channel,
          category,reason_code,redacted_question,occurred_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now()+interval '90 days')
       ON CONFLICT (business_id,source_ai_run_id) DO NOTHING
       RETURNING id`,
      [
        outcome.businessId,
        existingCluster.id,
        outcome.aiRunId,
        outcome.inboundMessageId,
        outcome.channel,
        classified.category,
        classified.reason,
        safeQuestion,
      ],
    );
    if (!occurrence?.id) return false;

    await manager.query(
      `UPDATE public.knowledge_gap_clusters SET
         occurrence_count=occurrence_count+1,last_seen_at=now(),updated_at=now(),
         last_reason_code=$3,
         status=CASE WHEN status='DISMISSED' THEN 'OPEN' ELSE status END
       WHERE business_id=$1 AND id=$2`,
      [outcome.businessId, existingCluster.id, classified.reason],
    );
    this.logger.log({
      event: 'learning.knowledge_gap_captured',
      businessId: outcome.businessId,
      category: classified.category,
      reasonCode: classified.reason,
    });
    return true;
  }
}
