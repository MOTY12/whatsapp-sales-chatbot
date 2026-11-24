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
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: gap.id, status: 'REVIEWED' }),
    });
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toContain(`/gaps/${gap.id}`);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      status: 'REVIEWED',
    });
    expect(await screen.findByText(/Marked as reviewed/)).toBeTruthy();
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
