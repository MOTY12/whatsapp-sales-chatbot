import {
  DeterministicEmbeddingProvider,
  EmbeddingProviderError,
  OpenAiEmbeddingProvider,
} from './embedding-provider';

describe('deterministic embedding fixture', () => {
  it('returns stable, finite vectors with exact requested dimensions', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const request = {
      texts: [
        'Can I return an item after three days?',
        'Can I return an item after three days?',
      ],
      model: 'fixture-v1',
      dimensions: 64,
    };
    const result = await provider.embed(request);
    expect(result.model).toBe(request.model);
    expect(result.dimensions).toBe(64);
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(64);
    expect(result.vectors[0]).toEqual(result.vectors[1]);
    expect(result.vectors.flat().every(Number.isFinite)).toBe(true);
  });
});

describe('OpenAI embedding provider response validation', () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.KNOWLEDGE_EMBEDDING_MODEL;
  const previousDimensions = process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-provider-key';
    process.env.KNOWLEDGE_EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS = '1536';
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined)
      delete process.env.KNOWLEDGE_EMBEDDING_MODEL;
    else process.env.KNOWLEDGE_EMBEDDING_MODEL = previousModel;
    if (previousDimensions === undefined)
      delete process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS;
    else process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS = previousDimensions;
  });

  it('classifies provider rate limits as retryable without logging response data', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 429 }));
    const provider = new OpenAiEmbeddingProvider();
    await expect(
      provider.embed({
        texts: ['A bounded query'],
        model: 'text-embedding-3-small',
        dimensions: 1536,
      }),
    ).rejects.toMatchObject({ category: 'RATE_LIMIT', retryable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRestore();
  });

  it('rejects provider vectors with the wrong dimensions', async () => {
    const vector = Array.from({ length: 1535 }, () => 0.1);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        model: 'text-embedding-3-small',
        data: [{ index: 0, embedding: vector }],
        usage: { prompt_tokens: 3 },
      }),
    );
    const provider = new OpenAiEmbeddingProvider();
    await expect(
      provider.embed({
        texts: ['A bounded query'],
        model: 'text-embedding-3-small',
        dimensions: 1536,
      }),
    ).rejects.toMatchObject({
      category: 'INVALID_RESPONSE',
      retryable: false,
    } satisfies Partial<EmbeddingProviderError>);
    jest.restoreAllMocks();
  });
});
