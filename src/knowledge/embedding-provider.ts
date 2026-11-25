import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { knowledgeIndexConfig } from '../config/env';

export type EmbeddingRequest = {
  texts: string[];
  model: string;
  dimensions: number;
};

export type EmbeddingResponse = {
  vectors: number[][];
  model: string;
  dimensions: number;
  inputTokens?: number;
};

export interface EmbeddingProvider {
  readonly name: string;
  embed(input: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export class EmbeddingProviderError extends Error {
  constructor(
    readonly category:
      | 'NOT_CONFIGURED'
      | 'RATE_LIMIT'
      | 'TIMEOUT'
      | 'UNAVAILABLE'
      | 'INVALID_RESPONSE'
      | 'REJECTED',
    readonly retryable: boolean,
  ) {
    super(category);
  }
}

function validate(
  request: EmbeddingRequest,
  response: EmbeddingResponse,
): EmbeddingResponse {
  if (
    !response ||
    !Array.isArray(response.vectors) ||
    response.model !== request.model ||
    response.dimensions !== request.dimensions ||
    response.vectors.length !== request.texts.length ||
    response.vectors.some(
      (vector) =>
        vector.length !== request.dimensions ||
        vector.some((value) => !Number.isFinite(value)),
    )
  )
    throw new EmbeddingProviderError('INVALID_RESPONSE', false);
  return response;
}

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const config = knowledgeIndexConfig();
    if (!config.apiKey)
      throw new EmbeddingProviderError('NOT_CONFIGURED', false);
    if (
      input.model !== config.model ||
      input.dimensions !== config.dimensions ||
      input.texts.length < 1 ||
      input.texts.length > config.batchSize ||
      input.texts.some((text) => !text || text.length > 32000)
    )
      throw new EmbeddingProviderError('INVALID_RESPONSE', false);
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          input: input.texts,
          dimensions: input.dimensions,
          encoding_format: 'float',
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new EmbeddingProviderError(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'TIMEOUT'
          : 'UNAVAILABLE',
        true,
      );
    }
    if (!response.ok) {
      if (response.status === 429)
        throw new EmbeddingProviderError('RATE_LIMIT', true);
      if (response.status >= 500)
        throw new EmbeddingProviderError('UNAVAILABLE', true);
      throw new EmbeddingProviderError('REJECTED', false);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EmbeddingProviderError('INVALID_RESPONSE', false);
    }
    const record =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : null;
    const data = Array.isArray(record?.data) ? record.data : [];
    const vectors = data.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !Array.isArray((item as { embedding?: unknown }).embedding)
      )
        return [];
      return (item as { embedding: unknown[] }).embedding.map((value) =>
        typeof value === 'number' ? value : Number.NaN,
      );
    });
    const indexes = data.map((item) =>
      item && typeof item === 'object'
        ? (item as { index?: unknown }).index
        : undefined,
    );
    if (
      data.length !== input.texts.length ||
      indexes.some(
        (index) =>
          !Number.isSafeInteger(index) ||
          Number(index) < 0 ||
          Number(index) >= input.texts.length,
      ) ||
      new Set(indexes).size !== input.texts.length
    )
      throw new EmbeddingProviderError('INVALID_RESPONSE', false);
    const ordered = data
      .map((item, index) => ({
        index: (item as { index: number }).index,
        vector: vectors[index],
      }))
      .sort((a, b) => a.index - b.index);
    const usage =
      record?.usage && typeof record.usage === 'object'
        ? (record.usage as Record<string, unknown>)
        : null;
    const result = {
      vectors: ordered.map((entry) => entry.vector),
      model: typeof record?.model === 'string' ? record.model : '',
      dimensions: input.dimensions,
      inputTokens:
        Number.isSafeInteger(usage?.prompt_tokens) &&
        Number(usage?.prompt_tokens) > 0
          ? Number(usage?.prompt_tokens)
          : undefined,
    };
    return validate(input, result);
  }
}

/** Repeatable fixture only; never selected by the production provider factory. */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deterministic';
  embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const vectors = input.texts.map((text) => {
      const vector = Array.from({ length: input.dimensions }, () => 0);
      const words = text.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [];
      for (const word of words) {
        const digest = createHash('sha256').update(word).digest();
        const index = digest.readUInt32BE(0) % vector.length;
        vector[index] += digest[4] % 2 ? 1 : -1;
      }
      const norm =
        Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / norm);
    });
    return Promise.resolve(
      validate(input, {
        vectors,
        model: input.model,
        dimensions: input.dimensions,
      }),
    );
  }
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
