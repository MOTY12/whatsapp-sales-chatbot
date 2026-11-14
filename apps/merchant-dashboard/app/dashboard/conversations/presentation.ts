import type { InboxMessage } from '@/lib/api';

export function messageStatusLabel(value: string): string {
  const status = value.toUpperCase();
  const labels: Record<string, string> = {
    RECEIVED: 'Received', PENDING: 'Queued', RESERVED: 'Queued', QUEUED: 'Queued',
    SENDING: 'Sending', ACCEPTED: 'Accepted by WhatsApp', SENT: 'Sent',
    DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', UNCERTAIN: 'Delivery uncertain',
    SUPPRESSED: 'Not sent', UNKNOWN: 'Delivery uncertain',
  };
  return labels[status] ?? 'Message status';
}

export function messageFailureText(message: InboxMessage): string | null {
  const status = message.status.toUpperCase();
  if (status === 'UNCERTAIN' || status === 'UNKNOWN') return 'Delivery is uncertain. Check before sending again.';
  if (status === 'FAILED') return 'Delivery failed. This message may not have reached the customer.';
  if (status === 'SUPPRESSED') return 'This message was stopped before delivery.';
  return null;
}

export function senderLabel(message: InboxMessage): string {
  if (message.direction === 'inbound') return 'Customer';
  if (message.authorization_kind === 'HUMAN') return 'You';
  if (message.authorization_kind === 'AI') return 'Automation';
  return 'Kleva';
}

export function formatInboxTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)}`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function mergeMessages(existing: InboxMessage[], recent: InboxMessage[]): InboxMessage[] {
  const byId = new Map<string, InboxMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of recent) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => {
    const timeOrder = Date.parse(left.created_at) - Date.parse(right.created_at);
    return timeOrder || left.id.localeCompare(right.id);
  });
}
