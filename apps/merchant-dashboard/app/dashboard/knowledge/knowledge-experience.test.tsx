import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeExperience } from './knowledge-experience';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KnowledgeExperience', () => {
  it('shows FAQ indexing state and queues reindex with an idempotency key', async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST')
          return new Response(
            JSON.stringify({ generation_id: 'generation-1' }),
            {
              status: 202,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    render(
      <KnowledgeExperience
        businessId="business-1"
        initialError={null}
        initialFaqs={[
          {
            id: 'faq-1',
            status: 'PUBLISHED',
            revision: 1,
            published_revision: 1,
            has_unpublished_changes: false,
            question: 'What is your return policy?',
            answer: 'Returns are accepted within seven days.',
            published_at: '2026-11-24T00:00:00.000Z',
            created_at: '2026-11-24T00:00:00.000Z',
            updated_at: '2026-11-24T00:00:00.000Z',
          },
        ]}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Build semantic index' }),
    );
    expect(await screen.findByText(/Semantic indexing queued/)).toBeTruthy();
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/knowledge/business-1/faq-1/reindex');
    expect(new Headers(post?.[1]?.headers).get('Idempotency-Key')).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it('shows the empty state and validates required question and answer fields', async () => {
    render(
      <KnowledgeExperience
        businessId="business-1"
        initialFaqs={[]}
        initialError={null}
      />,
    );
    expect(screen.getByText('No FAQs yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Customer question/), {
      target: { value: 'What time do you open?' },
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Save draft' }).at(-1)!,
    );
    expect((await screen.findAllByRole('alert')).at(-1)).toHaveTextContent(
      'Add an answer before saving.',
    );
  });
});
