import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MerchantPrincipal } from '../Auth/auth.service';
import { MerchantAccess } from '../Auth/merchant-access.service';
import { knowledgeIndexConfig } from '../config/env';
import { knowledgeChunkingVersion } from './knowledge-chunker';

type IndexStatusRow = {
  generation_id: string;
  status: string;
  chunk_count: number;
  expected_chunks: number;
  indexed_at: Date | null;
  failure_category: string | null;
  semantic_ready: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class KnowledgeIndexingService {
  constructor(private readonly access: MerchantAccess) {}

  request(
    actor: MerchantPrincipal,
    businessId: string,
    requestKey: string | undefined,
    sourceType: 'FAQ' | 'PRODUCT' | 'DOCUMENT',
    sourceId: string,
  ) {
    if (!uuid.test(sourceId))
      throw new BadRequestException('Invalid source identifier.');
    if (!requestKey || !uuidV4.test(requestKey))
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    const config = knowledgeIndexConfig();
    if (!config.apiKey)
      throw new ServiceUnavailableException(
        'Semantic indexing is not configured.',
      );
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const rows = await manager.query<
          Array<{
            generation_id: string;
            status: string;
            source_revision_id: string;
          }>
        >(
          'SELECT * FROM public.kleva_knowledge_index_start($1,$2,$3,$4,$5,$6,$7)',
          [
            requestKey,
            sourceType,
            sourceId,
            config.provider,
            config.model,
            config.dimensions,
            knowledgeChunkingVersion,
          ],
        );
        const result = rows[0];
        if (!result)
          throw new BadRequestException(
            'Published knowledge source was not found.',
          );
        return result;
      },
    );
  }

  async status(
    actor: MerchantPrincipal,
    businessId: string,
    sourceType: 'FAQ' | 'PRODUCT' | 'DOCUMENT',
    sourceId: string,
  ) {
    if (!uuid.test(sourceId))
      throw new BadRequestException('Invalid source identifier.');
    const rows = await this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      (manager) =>
        manager.query<IndexStatusRow[]>(
          'SELECT * FROM public.kleva_knowledge_index_status($1,$2)',
          [sourceType, sourceId],
        ),
    );
    const config = knowledgeIndexConfig();
    return rows.map((row) => ({
      ...row,
      semantic_search_enabled: config.enabled && Boolean(config.apiKey),
    }));
  }
}
