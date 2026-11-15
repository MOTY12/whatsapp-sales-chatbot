import type { EvidenceItem } from '../knowledge/unified-knowledge-retrieval.service';
import type { GroundedModelResponse } from './grounded-model.provider';

export type ValidationResult =
  { valid: true } | { valid: false; reason: string };

const prohibitedUnverified =
  /\b(discount(?:ed)?|save\s+\d|free\s+delivery|deliver(?:y|s|ed)?\s+(?:today|tomorrow|within|in\s+\d)|arrive(?:s)?\s+(?:today|tomorrow|within)|guarantee(?:d)?\s+(?:delivery|arrival))\b/i;
const moneyPattern =
  /(?:\b(?:NGN|USD|GHS|KES|EUR|GBP)\s*|[₦$€£])([0-9][0-9,]*(?:\.[0-9]+)?)/gi;

export function validateGroundedResponse(
  response: GroundedModelResponse,
  evidence: EvidenceItem[],
): ValidationResult {
  if (
    typeof response.reply !== 'string' ||
    response.reply.trim().length < 2 ||
    response.reply.length > 900
  )
    return { valid: false, reason: 'MALFORMED_REPLY' };
  const byId = new Map(evidence.map((item) => [item.sourceId, item]));
  if (
    !response.evidenceIds.length ||
    response.evidenceIds.some((id) => !byId.has(id))
  )
    return { valid: false, reason: 'INVALID_EVIDENCE_REFERENCE' };
  if (!response.canAnswer || response.needsHuman)
    return { valid: false, reason: 'MODEL_ABSTAINED' };
  if (prohibitedUnverified.test(response.reply))
    return { valid: false, reason: 'UNSUPPORTED_COMMERCIAL_CLAIM' };

  const cited = response.evidenceIds.map((id) => byId.get(id)!);
  const groundingText = cited
    .map(
      (item) =>
        `${item.title} ${item.content} ${JSON.stringify(item.facts ?? {})}`,
    )
    .join(' ')
    .toLocaleLowerCase();
  const stopWords = new Set([
    'about',
    'after',
    'also',
    'are',
    'can',
    'does',
    'from',
    'have',
    'here',
    'how',
    'into',
    'item',
    'more',
    'please',
    'that',
    'the',
    'this',
    'with',
    'your',
  ]);
  const answerTerms =
    response.reply.toLocaleLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const meaningfulTerms = answerTerms.filter((term) => !stopWords.has(term));
  if (
    meaningfulTerms.length &&
    meaningfulTerms.filter((term) => groundingText.includes(term)).length /
      meaningfulTerms.length <
      0.4
  )
    return { valid: false, reason: 'WEAK_EVIDENCE_OVERLAP' };
  const productEvidence = cited.filter((item) => item.sourceType === 'PRODUCT');
  const amounts = [...response.reply.matchAll(moneyPattern)];
  if (
    productEvidence.length &&
    /\b(?:price|costs?|priced)\b/i.test(response.reply) &&
    amounts.length === 0
  ) {
    return { valid: false, reason: 'UNSUPPORTED_PRICE_OR_CURRENCY' };
  }
  for (const match of amounts) {
    const amount = Number(match[1].replaceAll(',', ''));
    const currency = match[0].match(/NGN|USD|GHS|KES|EUR|GBP|[₦$€£]/i)?.[0];
    const supported = productEvidence.some((item) => {
      const price = item.facts?.price;
      if (price === null || price === undefined) return false;
      const currencyMatches =
        currency === item.facts?.currency ||
        (currency === '₦' && item.facts?.currency === 'NGN') ||
        (currency === '$' && item.facts?.currency === 'USD') ||
        (currency === '€' && item.facts?.currency === 'EUR') ||
        (currency === '£' && item.facts?.currency === 'GBP');
      return currencyMatches && Number(price) === amount;
    });
    if (!supported)
      return { valid: false, reason: 'UNSUPPORTED_PRICE_OR_CURRENCY' };
  }

  const availabilityClaim =
    /\b(in stock|available now|out of stock|currently unavailable)\b/i.test(
      response.reply,
    );
  if (
    availabilityClaim &&
    !productEvidence.some((item) => item.facts?.availability !== 'UNKNOWN')
  )
    return { valid: false, reason: 'UNKNOWN_AVAILABILITY_CLAIM' };
  if (
    /\b(in stock|available now)\b/i.test(response.reply) &&
    !productEvidence.some((item) => item.facts?.availability === 'IN_STOCK')
  )
    return { valid: false, reason: 'UNSUPPORTED_AVAILABILITY_CLAIM' };
  if (
    /\b(out of stock|currently unavailable)\b/i.test(response.reply) &&
    !productEvidence.some((item) => item.facts?.availability === 'OUT_OF_STOCK')
  )
    return { valid: false, reason: 'UNSUPPORTED_AVAILABILITY_CLAIM' };
  return { valid: true };
}
