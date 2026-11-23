import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantConfiguration, PlaygroundResult } from '@/lib/api';
import { AssistantExperience } from './assistant-experience';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const config: AssistantConfiguration = {
  businessId: 'business-1',
  revision: 0,
  assistantName: 'Kleva Assistant',
  greeting: 'Hello! How can I help you today?',
  tone: 'FRIENDLY',
  language: 'ENGLISH',
  responseLength: 'BALANCED',
  handoffBehavior: 'OFFER_HUMAN',
  fallbackResponse: 'A team member can help.',
  updatedAt: null,
};

const readiness = {
  profileConfigured: true,
  publishedKnowledgeCount: 1,
  settingsSaved: false,
  whatsappConnected: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AssistantExperience', () => {
  it('saves versioned preferences and shows grounded diagnostics and citations', async () => {
    const saved = { ...config, revision: 1 };
    const result: PlaygroundResult = {
      reply: 'We deliver within Lagos.',
      outcome: 'ANSWERED',
      sources: [
        {
          id: 'faq-1',
          revisionId: 'revision-1',
          type: 'FAQ',
          title: 'Delivery',
          excerpt: 'We deliver within Lagos.',
        },
      ],
      tokenUsage: { input: 45, output: 11, kind: 'ACTUAL' },
      durationMs: 31,
      handoffRecommended: false,
      toolExecutions: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(saved), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssistantExperience
        businessId="business-1"
        initialConfiguration={config}
        initialError={null}
        readiness={readiness}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Save assistant settings' }),
    );
    await screen.findByText(/Assistant settings saved/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject(
      { revision: 0, language: 'ENGLISH' },
    );

    fireEvent.change(screen.getByLabelText('Test customer message'), {
      target: { value: 'Do you deliver?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(
      (await screen.findAllByText('We deliver within Lagos.')).length,
    ).toBe(2);
    expect(screen.getByText('Grounded answer')).toBeTruthy();
    expect(screen.getByText(/FAQ · Delivery/)).toBeTruthy();
    expect(screen.getByText(/Actual tokens: 45 in · 11 out/)).toBeTruthy();
  });

  it('shows insufficient evidence and resets only the local synthetic conversation', async () => {
    const result: PlaygroundResult = {
      reply: config.fallbackResponse,
      outcome: 'INSUFFICIENT_EVIDENCE',
      sources: [],
      tokenUsage: { input: 0, output: 0, kind: 'ACTUAL' },
      durationMs: 8,
      handoffRecommended: true,
      toolExecutions: [
        {
          requestedTool: 'request_human_handoff',
          validation: 'VALID',
          simulatedOutcome: 'WOULD_HAND_OFF',
          sideEffects: false,
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssistantExperience
        businessId="business-1"
        initialConfiguration={config}
        initialError={null}
        readiness={readiness}
      />,
    );
    fireEvent.change(screen.getByLabelText('Test customer message'), {
      target: { value: 'Do you offer discounts?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(
      await screen.findByText('Not enough published evidence'),
    ).toBeTruthy();
    expect(
      screen.getByText('A human handoff would be recommended'),
    ).toBeTruthy();
    expect(screen.getByText('Tool simulation (no live changes)')).toBeTruthy();
    expect(
      screen.getByText(/Simulated: WOULD_HAND_OFF · no side effects/),
    ).toBeTruthy();
    expect(screen.queryByText('Published sources used')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset test' }));
    await waitFor(() =>
      expect(screen.queryByText('Not enough published evidence')).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
