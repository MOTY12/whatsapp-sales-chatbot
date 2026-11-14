import { describe, expect, it } from 'vitest';
import type { InboxMessage } from '@/lib/api';
import { formatInboxTime, mergeMessages, messageFailureText, messageStatusLabel, senderLabel } from './presentation';

const message = (id: string, created_at: string, extra: Partial<InboxMessage> = {}): InboxMessage => ({
  id, direction: 'outbound', content: 'Hello', status: 'ACCEPTED', provider_message_id: null,
  created_at, authorization_kind: 'HUMAN', error_classification: null, ...extra,
});

describe('inbox presentation', () => {
  it('uses clear delivery labels without exposing provider classifications', () => {
    expect(messageStatusLabel('ACCEPTED')).toBe('Accepted by WhatsApp');
    expect(messageFailureText(message('a', '2026-01-01T00:00:00Z', { status: 'UNCERTAIN', error_classification: 'PROVIDER_HTTP_401' }))).toContain('uncertain');
    expect(senderLabel(message('a', '2026-01-01T00:00:00Z', { authorization_kind: 'AI' }))).toBe('Automation');
  });

  it('merges duplicate poll pages and keeps chronological order', () => {
    const older = message('a', '2026-01-01T00:00:00Z');
    const newer = message('b', '2026-01-02T00:00:00Z');
    expect(mergeMessages([newer], [older, newer])).toEqual([older, newer]);
  });

  it('formats invalid activity timestamps as empty', () => {
    expect(formatInboxTime('not-a-date')).toBe('');
  });
});
