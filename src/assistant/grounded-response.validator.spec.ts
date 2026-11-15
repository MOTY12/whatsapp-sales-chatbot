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
});
