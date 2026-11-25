import type { Metadata } from 'next';
import { InvitationAcceptance } from './invitation-acceptance';

export const metadata: Metadata = {
  title: 'Accept invitation | Kleva',
  referrer: 'no-referrer',
};

export default function AcceptInvitationPage() {
  return (
    <main className="auth-page">
      <InvitationAcceptance />
    </main>
  );
}
