import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGap } from '@/lib/api';
import { LearningGapsExperience } from './learning-gaps-experience';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const gap: KnowledgeGap = {
  id: '22222222-2222-4222-8222-222222222222',
  category: 'MISSING_KNOWLEDGE',
  topic_label: 'delivery coverage ikeja',
  normalized_topic: 'delivery coverage ikeja',
  status: 'OPEN',
  occurrence_count: 3,
  first_seen_at: '2026-01-01T00:00:00.000Z',
  last_seen_at: '2026-01-03T00:00:00.000Z',
  last_reason_code: 'NO_MATCH',
  sample_question: 'Can you deliver around Ikeja?',
};

describe('LearningGapsExperience', () => {
  it('shows grouped redacted topics and lets the merchant mark a topic reviewed', async () => {
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        void init;
        return {
          ok: true,
          status: 200,
          json: async () =>
            String(url).includes('/gaps/')
              ? { id: gap.id, status: 'REVIEWED' }
              : String(url).includes('/faqs')
                ? []
                : { items: [] },
        };
      },
    );
    vi.stubGlobal('fetch', fetch);
    render(
      <LearningGapsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialGaps={[gap]}
        initialError={null}
      />,
    );
    expect(screen.getByRole('heading', { name: gap.topic_label })).toBeTruthy();
    expect(screen.getByText(/3\s+occurrences/)).toBeTruthy();
    expect(screen.getByText(gap.sample_question!)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) =>
          String(url).includes(`/gaps/${gap.id}`),
        ),
      ).toBe(true),
    );
    const updateCall = fetch.mock.calls.find(([url]) =>
      String(url).includes(`/gaps/${gap.id}`),
    );
    expect(updateCall?.[0]).toContain(`/gaps/${gap.id}`);
    expect(JSON.parse(updateCall?.[1]?.body as string)).toEqual({
      status: 'REVIEWED',
    });
    expect(await screen.findByText(/Marked as reviewed/)).toBeTruthy();
  });

  it('shows a deterministic duplicate-question conflict with both answers and lets a merchant retain the published answer', async () => {
    const suggestion = {
      id: '33333333-3333-4333-8333-333333333333',
      gap_cluster_id: gap.id,
      status: 'PENDING_REVIEW',
      origin: 'MANUAL',
      version: 2,
      proposed_question: 'Do you deliver to Ikeja?',
      proposed_answer: 'No, we do not deliver to Ikeja.',
      approved_faq_id: null,
      approved_revision_id: null,
      generation_id: null,
      evaluation_status: 'PENDING',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        void init;
        return {
          ok: true,
          status: 200,
          json: async () =>
            String(url).includes('/faqs')
              ? [
                  {
                    id: '44444444-4444-4444-8444-444444444444',
                    status: 'PUBLISHED',
                    revision: 3,
                    published_revision: 2,
                    has_unpublished_changes: false,
                    question: 'Do you deliver to Ikeja?',
                    answer: 'Yes, delivery to Ikeja is available.',
                    published_at: '2026-01-01T00:00:00.000Z',
                    created_at: '2025-12-01T00:00:00.000Z',
                    updated_at: '2026-01-01T00:00:00.000Z',
                  },
                ]
              : String(url).endsWith('/dismiss')
                ? { id: suggestion.id, status: 'DISMISSED' }
                : {
                    items: String(url).includes('/suggestions')
                      ? [suggestion]
                      : [],
                  },
        };
      },
    );
    vi.stubGlobal('fetch', fetch);
    render(
      <LearningGapsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialGaps={[]}
        initialError={null}
      />,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/same normalized question/)).toBeTruthy();
    expect(
      screen.getByText('Yes, delivery to Ikeja is available.'),
    ).toBeTruthy();
    expect(
      screen.getAllByText('No, we do not deliver to Ikeja.').length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByRole('link', { name: 'Review the published FAQ' })
        .getAttribute('href'),
    ).toContain('#faq-44444444-4444-4444-8444-444444444444');
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep existing answer' }),
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) => String(url).endsWith('/dismiss')),
      ).toBe(true),
    );
    const dismissIndex = fetch.mock.calls.findIndex(([url]) =>
      String(url).endsWith('/dismiss'),
    );
    expect(
      JSON.parse(fetch.mock.calls[dismissIndex][1]?.body as string),
    ).toEqual({ reason: 'RETAIN_EXISTING_ANSWER' });
  });

  it('does not expose raw customer text when it was omitted during redaction', () => {
    render(
      <LearningGapsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialGaps={[{ ...gap, sample_question: null }]}
        initialError={null}
      />,
    );
    expect(
      screen.getByText(
        /Question text was omitted to protect customer information/,
      ),
    ).toBeTruthy();
  });
});
