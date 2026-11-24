import { createHash } from 'node:crypto';

export type KnowledgeGapCategory =
  | 'MISSING_KNOWLEDGE'
  | 'UNSUPPORTED_REQUEST'
  | 'CLARIFICATION_FAILURE'
  | 'STALE_KNOWLEDGE';

export type KnowledgeGapReason =
  | 'NO_MATCH'
  | 'INSUFFICIENT_EVIDENCE'
  | 'MODEL_ABSTAINED'
  | 'INVALID_EVIDENCE_REFERENCE'
  | 'UNSUPPORTED_COMMERCIAL_CLAIM'
  | 'UNSUPPORTED_DELIVERY_CLAIM'
  | 'WEAK_EVIDENCE_OVERLAP'
  | 'UNSUPPORTED_PRICE_OR_CURRENCY'
  | 'UNKNOWN_AVAILABILITY_CLAIM'
  | 'UNSUPPORTED_AVAILABILITY_CLAIM'
  | 'PUBLISHED_EVIDENCE_CHANGED';

const reasonCategories: Record<string, KnowledgeGapCategory> = {
  NO_MATCH: 'MISSING_KNOWLEDGE',
  INSUFFICIENT_EVIDENCE: 'MISSING_KNOWLEDGE',
  MODEL_ABSTAINED: 'CLARIFICATION_FAILURE',
  INVALID_EVIDENCE_REFERENCE: 'UNSUPPORTED_REQUEST',
  UNSUPPORTED_COMMERCIAL_CLAIM: 'UNSUPPORTED_REQUEST',
  UNSUPPORTED_DELIVERY_CLAIM: 'MISSING_KNOWLEDGE',
  WEAK_EVIDENCE_OVERLAP: 'MISSING_KNOWLEDGE',
  UNSUPPORTED_PRICE_OR_CURRENCY: 'MISSING_KNOWLEDGE',
  UNKNOWN_AVAILABILITY_CLAIM: 'MISSING_KNOWLEDGE',
  UNSUPPORTED_AVAILABILITY_CLAIM: 'MISSING_KNOWLEDGE',
  PUBLISHED_EVIDENCE_CHANGED: 'STALE_KNOWLEDGE',
};

const stopWords = new Set([
  'about',
  'abeg',
  'an',
  'and',
  'around',
  'are',
  'at',
  'can',
  'could',
  'dey',
  'do',
  'does',
  'for',
  'from',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'please',
  'reach',
  'the',
  'to',
  'una',
  'we',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'you',
  'your',
  'fit',
  'get',
  'want',
  'would',
  'make',
  'know',
  'tell',
  'say',
  'address',
  'email',
  'call',
  'phone',
  'link',
  'or',
]);

const sensitiveContent =
  /\b(password|passcode|one[- ]time code|otp|pin|cvv|cvc|security code|card number|credit card|debit card|bank account|bank details|account number|sort code|routing number|api key|access token|secret key|bearer token)\b/i;
const paymentCardNumber = /\b(?:\d[ -]?){15,19}\b/;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<![\p{L}\d])(?:\+?\d[\d\s().-]{7,}\d)(?![\p{L}\d])/gu;
const addressLine =
  /\b(?:my address is|address is|i live at|i stay at|my house is|at number)\s+[^,;!?\n]{4,}/giu;
const streetAddress =
  /\b\d{1,5}\s+(?:[\p{L}.'-]+\s+){0,5}(?:street|st\.?|road|rd\.?|avenue|ave\.?|close|crescent|drive|dr\.?|lane|estate|plot|flat|apartment)\b[^,;!?\n]*/giu;

/**
 * Redacts direct identifiers before text is persisted for learning. If the
 * message contains credentials or payment details, retain no question text.
 */
export function redactKnowledgeQuestion(value: string): string | null {
  if (sensitiveContent.test(value) || paymentCardNumber.test(value))
    return null;
  let text = [...value.normalize('NFKC')]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('');
  text = text.replace(email, '[email]');
  text = text.replace(phone, '[phone]');
  text = text.replace(addressLine, '[address]');
  text = text.replace(streetAddress, '[address]');
  text = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < 4) return null;
  return text.slice(0, 280);
}

/**
 * Deterministic topic normalization. This is intentionally local and
 * conservative; it merges common English/Pidgin phrasings without a paid
 * embedding or external clustering service.
 */
export function normalizeKnowledgeTopic(
  redactedQuestion: string | null,
  category: KnowledgeGapCategory,
): string {
  if (!redactedQuestion)
    return `${category.toLowerCase().replaceAll('_', ' ')} general`;
  const text = redactedQuestion.toLocaleLowerCase('en-NG');
  const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const delivery = tokens.some((token) =>
    [
      'deliver',
      'delivery',
      'delivers',
      'delivering',
      'shipping',
      'ship',
    ].includes(token),
  );
  const productTerms = tokens.filter((token) => !stopWords.has(token));
  const topicTokens = delivery
    ? productTerms.filter(
        (token) =>
          ![
            'deliver',
            'delivery',
            'delivers',
            'delivering',
            'shipping',
            'ship',
          ].includes(token),
      )
    : productTerms;
  const prefix = delivery
    ? 'delivery coverage'
    : category.toLowerCase().replaceAll('_', ' ');
  return `${prefix} ${topicTokens.slice(0, 8).join(' ')}`.trim().slice(0, 180);
}

export function classifyKnowledgeGapReason(
  reason: string | null | undefined,
): { category: KnowledgeGapCategory; reason: KnowledgeGapReason } | null {
  if (!reason || !(reason in reasonCategories)) return null;
  return {
    category: reasonCategories[reason],
    reason: reason as KnowledgeGapReason,
  };
}

export function stableKnowledgeGapId(
  businessId: string,
  category: KnowledgeGapCategory,
  normalizedTopic: string,
): { id: string; key: string } {
  const key = createHash('sha256')
    .update(`${businessId}\u0000${category}\u0000${normalizedTopic}`)
    .digest('hex');
  const hex = key.slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const id = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  return { id, key };
}
