import {
  classifyKnowledgeGapReason,
  normalizeKnowledgeTopic,
  redactKnowledgeQuestion,
  stableKnowledgeGapId,
} from './knowledge-gap-normalization';

describe('knowledge gap redaction and grouping', () => {
  it('groups common English and Nigerian Pidgin delivery questions', () => {
    const english = redactKnowledgeQuestion('Can you deliver around Ikeja?');
    const pidgin = redactKnowledgeQuestion('Una dey deliver reach Ikeja?');
    const third = redactKnowledgeQuestion('Do you deliver to Ikeja?');
    expect(normalizeKnowledgeTopic(english, 'MISSING_KNOWLEDGE')).toBe(
      'delivery coverage ikeja',
    );
    expect(normalizeKnowledgeTopic(pidgin, 'MISSING_KNOWLEDGE')).toBe(
      'delivery coverage ikeja',
    );
    expect(normalizeKnowledgeTopic(third, 'MISSING_KNOWLEDGE')).toBe(
      'delivery coverage ikeja',
    );
  });

  it('redacts direct contact and street address data before retaining text', () => {
    const safe = redactKnowledgeQuestion(
      'Can you deliver to 22 Adeola Odeku Road? Email ada@example.test or call +234 801 234 5678',
    );
    expect(safe).not.toContain('ada@example.test');
    expect(safe).not.toContain('+234 801 234 5678');
    expect(safe).not.toContain('22 Adeola Odeku Road');
    expect(safe).toContain('[email]');
    expect(safe).toContain('[phone]');
    expect(safe).toContain('[address]');
  });

  it('stores no question when content includes credentials or payment secrets', () => {
    expect(
      redactKnowledgeQuestion('My OTP is 123456, can you help?'),
    ).toBeNull();
    expect(
      redactKnowledgeQuestion('My card number is 4111111111111111'),
    ).toBeNull();
    expect(redactKnowledgeQuestion('4111 1111 1111 1111')).toBeNull();
    expect(redactKnowledgeQuestion('My password is p@ssword123')).toBeNull();
  });

  it('creates tenant-specific stable cluster IDs and allowlists only information outcomes', () => {
    const topic = 'delivery coverage ikeja';
    const first = stableKnowledgeGapId(
      'business-a',
      'MISSING_KNOWLEDGE',
      topic,
    );
    expect(
      stableKnowledgeGapId('business-a', 'MISSING_KNOWLEDGE', topic),
    ).toEqual(first);
    expect(
      stableKnowledgeGapId('business-b', 'MISSING_KNOWLEDGE', topic).id,
    ).not.toBe(first.id);
    expect(classifyKnowledgeGapReason('NO_MATCH')).toEqual({
      category: 'MISSING_KNOWLEDGE',
      reason: 'NO_MATCH',
    });
    expect(classifyKnowledgeGapReason('AGENT_TOOL_HANDOFF')).toBeNull();
    expect(classifyKnowledgeGapReason('MODEL_UNAVAILABLE')).toBeNull();
  });
});
