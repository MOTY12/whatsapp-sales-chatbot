import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';

type KnowledgeGapListRow = {
  id: string;
  category: string;
  topic_label: string;
  normalized_topic: string;
  status: LearningGapStatus;
  occurrence_count: number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  last_reason_code: string;
  sample_question: string | null;
};

export type LearningGapStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED';
const statuses = new Set<LearningGapStatus>(['OPEN', 'REVIEWED', 'DISMISSED']);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class MerchantLearningService {
  constructor(private readonly access: MerchantAccess) {}

  list(
    actor: MerchantPrincipal,
    businessId: string,
    status?: string,
    limit?: string,
  ) {
    const filter = status?.trim().toUpperCase() || null;
    if (filter !== null && !statuses.has(filter as LearningGapStatus)) {
      throw new BadRequestException('Choose a valid knowledge-gap status.');
    }
    const pageSize = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('Page size must be between 1 and 100.');
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const items = await manager.query<KnowledgeGapListRow[]>(
          'SELECT * FROM public.kleva_learning_gaps($1,$2)',
          [pageSize, filter],
        );
        return { items, limit: pageSize };
      },
    );
  }

  updateStatus(
    actor: MerchantPrincipal,
    businessId: string,
    clusterId: string,
    body: unknown,
  ) {
    if (!uuid.test(clusterId)) throw new NotFoundException();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid knowledge-gap update.');
    }
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).length !== 1 ||
      typeof input.status !== 'string' ||
      !statuses.has(input.status as LearningGapStatus)
    ) {
      throw new BadRequestException('Choose a valid knowledge-gap status.');
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [row] = await manager.query<
          {
            id: string;
            status: LearningGapStatus;
            updated_at: Date | string;
          }[]
        >('SELECT * FROM public.kleva_learning_gap_set_status($1,$2)', [
          clusterId,
          input.status,
        ]);
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }
}
