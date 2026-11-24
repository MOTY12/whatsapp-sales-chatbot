import type { DataSource } from 'typeorm';
import { UnifiedKnowledgeRetrievalService } from './unified-knowledge-retrieval.service';

describe('UnifiedKnowledgeRetrievalService', () => {
  it('abstains when candidates fall below the conservative relevance threshold', async () => {
    const faqRows = [
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
    ];
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('published_knowledge')
          ? faqRows
          : [
              {
                has_published_content: false,
                source_type: null,
                source_id: null,
                revision_id: null,
                relevance_score: null,
                title: null,
                content: null,
                page_number: null,
              },
            ],
      ),
    );
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
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM public.kleva_search_published_documents($1, $2, $3)',
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

  it('removes natural-language question words while keeping product identifiers searchable', async () => {
    const emptyRows = [
      {
        has_published_content: true,
        source_type: null,
        source_id: null,
        revision_id: null,
        relevance_score: null,
        title: null,
        content: null,
        sku: null,
        price: null,
        currency: null,
        availability: null,
      },
    ];
    const query = jest.fn(() => Promise.resolve(emptyRows));
    const service = new UnifiedKnowledgeRetrievalService({
      query,
    } as unknown as DataSource);

    await service.retrieve({
      businessId: '00000000-0000-4000-8000-000000000003',
      query: 'How much is Product A?',
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM public.kleva_search_published_knowledge($1, $2, $3)',
      ['00000000-0000-4000-8000-000000000003', 'How much is Product A?', 5],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      'SELECT * FROM public.kleva_search_published_knowledge($1, $2, $3)',
      ['00000000-0000-4000-8000-000000000003', 'product a', 5],
    );
  });
});
