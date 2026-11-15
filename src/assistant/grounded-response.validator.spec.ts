import { validateGroundedResponse } from './grounded-response.validator';
import type { EvidenceItem } from '../knowledge/unified-knowledge-retrieval.service';
import type { GroundedModelResponse } from './grounded-model.provider';

const evidence: EvidenceItem[] = [
  {
    sourceType: 'PRODUCT',
    sourceId: 'product-1',
    revisionId: 'revision-1',
    relevanceScore: 1,
    title: 'Kleva standing fan',
    content: 'Quiet standing fan with remote control.',
    sku: 'FAN-01',
    facts: { price: '25000.00', currency: 'NGN', availability: 'IN_STOCK' },
  },
];
const response = (
  reply: string,
  overrides: Partial<GroundedModelResponse> = {},
): GroundedModelResponse => ({
  reply,
  evidenceIds: ['product-1'],
  canAnswer: true,
  needsHuman: false,
  inputTokens: 100,
  outputTokens: 20,
  ...overrides,
});

describe('grounded response validation', () => {
  it('preserves published price and currency', () => {
    expect(
      validateGroundedResponse(
        response('The standing fan costs NGN 25,000.'),
        evidence,
      ),
    ).toEqual({ valid: true });
  });

  it('rejects changed currency, price, unknown stock and unsupported promotion claims', () => {
    expect(
      validateGroundedResponse(response('It costs USD 25,000.'), evidence),
    ).toMatchObject({ valid: false });
    expect(
      validateGroundedResponse(response('It costs NGN 20,000.'), evidence),
    ).toMatchObject({ valid: false });
    expect(
      validateGroundedResponse(
        response('It is in stock with a 20% discount.'),
        evidence,
      ),
    ).toMatchObject({ valid: false });
  });

  it('rejects evidence IDs from another tenant or source and model abstentions', () => {
    expect(
      validateGroundedResponse(
        response('The standing fan has a remote control.', {
          evidenceIds: ['other-tenant-id'],
        }),
        evidence,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateGroundedResponse(
        response('Please ask the merchant.', {
          canAnswer: false,
          needsHuman: true,
        }),
        evidence,
      ),
    ).toMatchObject({ valid: false });
  });

  it('rejects invented prices when a product price is null', () => {
    const unpriced = [
      {
        ...evidence[0],
        facts: {
          price: null,
          currency: 'NGN',
          availability: 'UNKNOWN' as const,
        },
      },
    ];
    expect(
      validateGroundedResponse(
        response('The standing fan costs NGN 25,000.', {
          evidenceIds: ['product-1'],
        }),
        unpriced,
      ),
    ).toMatchObject({ valid: false, reason: 'UNSUPPORTED_PRICE_OR_CURRENCY' });
  });

  it('rejects availability claims when published stock is unknown', () => {
    const unknownStock = [
      {
        ...evidence[0],
        facts: {
          price: '25000.00',
          currency: 'NGN',
          availability: 'UNKNOWN' as const,
        },
      },
    ];
    expect(
      validateGroundedResponse(
        response('The standing fan is in stock.', {
          evidenceIds: ['product-1'],
        }),
        unknownStock,
      ),
    ).toMatchObject({ valid: false, reason: 'UNKNOWN_AVAILABILITY_CLAIM' });
  });

  it('rejects unsupported delivery promises and policy claims', () => {
    expect(
      validateGroundedResponse(
        response('We offer delivery tomorrow.', { evidenceIds: ['product-1'] }),
        evidence,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateGroundedResponse(
        response('You can return it within 30 days.', {
          evidenceIds: ['product-1'],
        }),
        evidence,
      ),
    ).toMatchObject({ valid: false, reason: 'WEAK_EVIDENCE_OVERLAP' });
  });

  it('rejects empty, oversized and malformed replies', () => {
    expect(validateGroundedResponse(response(' '), evidence)).toMatchObject({
      valid: false,
      reason: 'MALFORMED_REPLY',
    });
    expect(
      validateGroundedResponse(response('x'.repeat(901)), evidence),
    ).toMatchObject({ valid: false, reason: 'MALFORMED_REPLY' });
    expect(
      validateGroundedResponse(
        response('A standing fan is quiet.', { evidenceIds: [] }),
        evidence,
      ),
    ).toMatchObject({ valid: false, reason: 'INVALID_EVIDENCE_REFERENCE' });
  });
});
