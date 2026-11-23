export type AssistantTone = 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL';
export type AssistantLanguage = 'ENGLISH' | 'NIGERIAN_PIDGIN';
export type AssistantResponseLength = 'SHORT' | 'BALANCED' | 'DETAILED';
export type AssistantHandoffBehavior = 'OFFER_HUMAN' | 'PRIORITIZE_HUMAN';

export type AssistantPreferences = {
  assistantName: string;
  greeting: string;
  tone: AssistantTone;
  language: AssistantLanguage;
  responseLength: AssistantResponseLength;
  handoffBehavior: AssistantHandoffBehavior;
  fallbackResponse: string;
};

export type AssistantConfiguration = AssistantPreferences & {
  businessId: string;
  revision: number;
  updatedAt: string | null;
};

export const defaultAssistantPreferences: AssistantPreferences = {
  assistantName: 'Kleva Assistant',
  greeting: 'Hello! How can I help you today?',
  tone: 'FRIENDLY',
  language: 'ENGLISH',
  responseLength: 'BALANCED',
  handoffBehavior: 'OFFER_HUMAN',
  fallbackResponse:
    'I don’t have enough published information to answer confidently. A team member can help.',
};

export type PlaygroundOutcome =
  | 'ANSWERED'
  | 'CLARIFICATION'
  | 'HANDOFF'
  | 'INSUFFICIENT_EVIDENCE'
  | 'PROVIDER_FAILURE';

export type PlaygroundMessage = {
  role: 'customer' | 'assistant';
  content: string;
};

export type PlaygroundSource = {
  id: string;
  revisionId: string;
  type: 'FAQ' | 'PRODUCT';
  title: string;
  excerpt: string;
};

export type PlaygroundResult = {
  reply: string;
  outcome: PlaygroundOutcome;
  sources: PlaygroundSource[];
  tokenUsage: { input: number; output: number; kind: 'ACTUAL' | 'ESTIMATED' };
  durationMs: number;
  handoffRecommended: boolean;
};
