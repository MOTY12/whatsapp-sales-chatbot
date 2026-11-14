import type { WhatsAppStatus } from '@/lib/api';

const labels: Record<WhatsAppStatus['status'] | 'unknown', string> = { active: 'Connected', inactive: 'Action required', pending: 'Not connected', unknown: 'Status unavailable' };
export function StatusBadge({ status }: { status: WhatsAppStatus['status'] | 'unknown' }) {
  return <span className={`status-badge status-${status}`}><i aria-hidden="true"/>{labels[status]}</span>;
}
