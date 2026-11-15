import type { DataSource } from 'typeorm';
import { UnifiedKnowledgeRetrievalService } from './unified-knowledge-retrieval.service';

describe('UnifiedKnowledgeRetrievalService', () => {
  it('abstains when candidates fall below the conservative relevance threshold', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        has_published_content: true,
        source_type: 'FAQ',
        source_id: '00000000-0000-4000-8000-000000000001',
        revision_id: '00000000-0000-4000-8000-000000000002',
        relevance_score: 0.01,
        title: 'Shop location',
        content: 'Find us in Ikeja.',
        sku: null,
        price: null,
        currency: null,
        availability: null,
      },
    ]);
    const service = new UnifiedKnowledgeRetrievalService({
      query,
    } as unknown as DataSource);

    await expect(
      service.retrieve({
        businessId: '00000000-0000-4000-8000-000000000003',
        query: 'returns',
      }),
    ).resolves.toEqual({
      evidence: [],
      sufficientEvidence: false,
      reason: 'LOW_RELEVANCE',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM public.kleva_search_published_knowledge($1, $2, $3)',
      ['00000000-0000-4000-8000-000000000003', 'returns', 5],
    );
  });

  it('rejects malformed input before touching PostgreSQL', async () => {
    const query = jest.fn();
    const service = new UnifiedKnowledgeRetrievalService({
      query,
    } as unknown as DataSource);

    await expect(
      service.retrieve({
        businessId: 'not-a-uuid',
        query: 'shipping',
      }),
    ).rejects.toThrow('Invalid business ID.');
    await expect(
      service.retrieve({
        businessId: '00000000-0000-4000-8000-000000000003',
        query: 'x'.repeat(257),
      }),
    ).rejects.toThrow('Search query must be at most 256 characters.');
    await expect(
      service.retrieve({
        businessId: '00000000-0000-4000-8000-000000000003',
        query: 'shipping',
        limit: 11,
      }),
    ).rejects.toThrow('Search limit must be between 1 and 10.');
    expect(query).not.toHaveBeenCalled();
  });
});
