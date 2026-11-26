import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MerchantAnalyticsReport } from '@/lib/api';
import { AnalyticsExperience } from './analytics-experience';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

const report: MerchantAnalyticsReport = {
  generatedAt: '2026-11-25T10:00:00.000Z',
  range: {
    from: '2026-11-01',
    to: '2026-11-30',
    toExclusive: '2026-12-01',
    timezone: 'Africa/Lagos',
  },
  engagement: {
    inboundConversations: 0,
    inboundMessages: 0,
    acceptedReplies: 0,
    activeConversations: 0,
    awaitingResponse: 0,
    resolvedEvents: 0,
    reopenedEvents: 0,
    trend: [],
  },
  responses: {
    aiOnly: 0,
    humanOnly: 0,
    mixed: 0,
    unanswered: 0,
    answered: 0,
    medianFirstResponseSeconds: null,
    medianAiFirstResponseSeconds: null,
    medianHumanFirstResponseSeconds: null,
  },
  ai: {
    failedGenerations: 0,
    insufficientEvidence: 0,
    suppressed: 0,
    eligible: 0,
    accepted: 0,
    acceptanceRate: null,
  },
  handoffs: {
    recordedEvents: 0,
    conversations: 0,
    awaitingHuman: 0,
    reasons: [],
  },
  sales: {
    leadsCreated: 0,
    qualifiedLeads: 0,
    qualificationRate: null,
    cohortWon: 0,
    cohortConversionRate: null,
    openOpportunities: 0,
    won: 0,
    lost: 0,
    recordedValuesByCurrency: [],
    leadTrend: [],
    revenueAvailability: 'UNAVAILABLE_NO_RECORDED_VALUES',
  },
  knowledge: {
    occurrences: 0,
    topics: 0,
    openTopics: 0,
    reviewedTopics: 0,
    topTopics: [],
    publishedImprovements: 0,
    failedIndexing: 0,
    completedEvaluations: 0,
    evaluationCases: 0,
    groundedValidCases: 0,
  },
  usage: [],
  team: { canView: true, agents: [] },
  channels: [],
  monthlyAllowances: {
    whatsappOutbound: { limit: 1000, quotaCounted: 0, remaining: 1000 },
    aiInputTokens: { limit: 100000, quotaCounted: 0, remaining: 100000 },
    aiOutputTokens: { limit: 50000, quotaCounted: 0, remaining: 50000 },
    embeddings: { limit: 100000, quotaCounted: 0, remaining: 100000 },
  },
  availability: {
    estimatedModelCost: 'UNAVAILABLE_MODEL_PRICING_NOT_CONFIGURED',
  },
};

describe('AnalyticsExperience', () => {
  it('shows zero counts and keeps rates, response time and revenue unavailable without activity', () => {
    render(<AnalyticsExperience report={report} businessName="Sample Shop" />);
    expect(screen.getByText('Customer conversations')).toBeTruthy();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('No customer activity in this date range.'),
    ).toBeTruthy();
    expect(screen.getByText('Unavailable · no recorded value')).toBeTruthy();
    expect(
      screen.getByText(
        /Costs are unavailable because model-specific pricing is not configured/,
      ),
    ).toBeTruthy();
  });

  it('renders channel and team tables only from supplied records', () => {
    render(
      <AnalyticsExperience
        businessName="Sample Shop"
        report={{
          ...report,
          engagement: {
            ...report.engagement,
            inboundConversations: 4,
            inboundMessages: 5,
            trend: [{ date: '2026-11-02', conversations: 4 }],
          },
          channels: [
            {
              channel: 'WEBSITE',
              inboundConversations: 4,
              acceptedAiResponses: 2,
              humanResponses: 1,
              medianFirstResponseSeconds: 28,
              leadsCreated: 3,
              qualifiedLeads: 1,
              recordedConversions: 1,
            },
          ],
          team: {
            canView: true,
            agents: [
              {
                name: 'Amaka',
                conversationsHandled: 1,
                acceptedReplies: 1,
                resolvedConversations: 1,
                medianResponseSeconds: 42,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole('cell', { name: 'Website chat' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Amaka' })).toBeTruthy();
    expect(
      screen.queryByText('No customer activity in this date range.'),
    ).toBeFalsy();
  });
});
