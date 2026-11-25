import {
  chunkKnowledgeText,
  knowledgeChunkingVersion,
} from './knowledge-chunker';

describe('knowledge chunking', () => {
  const options = { targetTokens: 80, maxTokens: 100, overlapTokens: 12 };

  it('keeps FAQ question and answer in one chunk when within the configured bound', () => {
    const [chunk] = chunkKnowledgeText(
      [
        {
          title: 'Delivery FAQ',
          text: 'Do you deliver to Ikeja?\n\nYes, we deliver there.',
        },
      ],
      options,
    );
    expect(chunk.content).toContain('Do you deliver to Ikeja?');
    expect(chunk.content).toContain('Yes, we deliver there.');
    expect(chunk.tokenCount).toBeLessThanOrEqual(options.maxTokens);
    expect(knowledgeChunkingVersion).toBe('sentence-cl100k-v1');
  });

  it('preserves PDF page attribution, deterministic checksums, offsets and bounded overlap', () => {
    const text = Array.from(
      { length: 40 },
      (_, index) =>
        `Delivery coverage paragraph ${index + 1} includes Ikeja and Lagos.`,
    ).join(' ');
    const source = [
      { title: 'Delivery policy', text, pageNumber: 2, sourceOffset: 0 },
    ];
    const first = chunkKnowledgeText(source, options);
    const second = chunkKnowledgeText(source, options);
    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => chunk.checksum)).toEqual(
      second.map((chunk) => chunk.checksum),
    );
    expect(first.every((chunk) => chunk.pageNumber === 2)).toBe(true);
    expect(first.every((chunk) => chunk.tokenCount <= options.maxTokens)).toBe(
      true,
    );
    expect(first[0].startOffset).toBe(0);
    expect(first.every((chunk) => chunk.endOffset >= chunk.startOffset)).toBe(
      true,
    );
    expect(
      first.every(
        (chunk) =>
          text.slice(chunk.startOffset, chunk.endOffset) === chunk.content,
      ),
    ).toBe(true);
    expect(first[1].content).toContain(first[0].content.slice(-20).trim());
  });

  it('rejects invalid chunk settings and excessive source counts', () => {
    expect(() =>
      chunkKnowledgeText([{ title: 'x', text: 'y' }], {
        ...options,
        overlapTokens: 80,
      }),
    ).toThrow('INVALID_CHUNK_CONFIGURATION');
    expect(() => chunkKnowledgeText([], options)).toThrow('CHUNK_LIMIT');
  });
});
