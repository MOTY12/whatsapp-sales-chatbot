import { createHash } from 'node:crypto';
import { decode, encode } from 'gpt-tokenizer/cjs/encoding/cl100k_base';

export const knowledgeChunkingVersion = 'sentence-cl100k-v1';

export type ChunkSource = {
  title: string;
  text: string;
  pageNumber?: number | null;
  sourceOffset?: number;
};

export type KnowledgeTextChunk = {
  chunkIndex: number;
  title: string;
  content: string;
  pageNumber: number | null;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
  checksum: string;
};

function splitAtSentence(tokens: number[], maximum: number): number {
  if (tokens.length <= maximum) return tokens.length;
  const minimum = Math.max(1, Math.floor(maximum * 0.6));
  for (let end = maximum; end >= minimum; end--) {
    const tail = decode(tokens.slice(0, end));
    if (/[.!?。！？]\s*$/.test(tail) || /\n\s*$/.test(tail)) return end;
  }
  return maximum;
}

/** Deterministic cl100k chunking, bounded by page/source and preserving overlap. */
export function chunkKnowledgeText(
  sources: readonly ChunkSource[],
  options: { targetTokens: number; maxTokens: number; overlapTokens: number },
): KnowledgeTextChunk[] {
  const { targetTokens, maxTokens, overlapTokens } = options;
  if (
    !Number.isSafeInteger(targetTokens) ||
    !Number.isSafeInteger(maxTokens) ||
    !Number.isSafeInteger(overlapTokens) ||
    targetTokens < 1 ||
    maxTokens < targetTokens ||
    overlapTokens < 0 ||
    overlapTokens >= targetTokens
  )
    throw new Error('INVALID_CHUNK_CONFIGURATION');
  const chunks: KnowledgeTextChunk[] = [];
  for (const source of sources) {
    const text = source.text;
    if (!text) continue;
    const tokens = encode(text);
    let from = 0;
    while (from < tokens.length) {
      const remaining = tokens.length - from;
      const targetEnd = from + Math.min(targetTokens, remaining);
      let end =
        splitAtSentence(tokens.slice(from), Math.min(maxTokens, remaining)) +
        from;
      if (end > targetEnd && remaining > targetTokens) end = targetEnd;
      if (end <= from) end = Math.min(tokens.length, from + maxTokens);
      const content = decode(tokens.slice(from, end)).trim();
      if (content) {
        const rawContent = decode(tokens.slice(from, end));
        const prefixLength = decode(tokens.slice(0, from)).length;
        const leadingTrim = rawContent.length - rawContent.trimStart().length;
        const trailingTrim = rawContent.length - rawContent.trimEnd().length;
        const startOffset =
          (source.sourceOffset ?? 0) + prefixLength + leadingTrim;
        const tokenCount = end - from;
        chunks.push({
          chunkIndex: chunks.length,
          title: source.title.slice(0, 500),
          content,
          pageNumber: source.pageNumber ?? null,
          startOffset,
          endOffset:
            (source.sourceOffset ?? 0) +
            prefixLength +
            rawContent.length -
            trailingTrim,
          tokenCount,
          checksum: createHash('sha256').update(content, 'utf8').digest('hex'),
        });
      }
      if (end >= tokens.length) break;
      from = Math.max(from + 1, end - overlapTokens);
    }
    // FAQ question and answer and a product description are each a single source;
    // PDF pages arrive as separate sources so chunk citations stay on one page.
  }
  if (!chunks.length || chunks.length > 2000) throw new Error('CHUNK_LIMIT');
  return chunks;
}
