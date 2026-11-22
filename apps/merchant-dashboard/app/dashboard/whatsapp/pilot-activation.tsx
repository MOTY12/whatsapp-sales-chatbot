import type { MerchantPilotStatus, WhatsAppStatus } from '@/lib/api';
import {
  requestPilotReviewFromDashboard,
  revokePilotFromDashboard,
} from '../actions';
import styles from './pilot-activation.module.css';

type Props = {
  businessId: string;
  canManage: boolean;
  connection: WhatsAppStatus | undefined;
  pilot: MerchantPilotStatus | undefined;
  pilotAvailable: boolean;
  result?: string;
};

export function PilotActivation({
  businessId,
  canManage,
  connection,
  pilot,
  pilotAvailable,
  result,
}: Props) {
  const state = pilot?.status ?? 'NOT_ENROLLED';
  const verifiedConnection =
    connection?.status === 'active' &&
    connection.connectionState === 'connected' &&
    Boolean(connection.id);
  const canEnroll =
    pilotAvailable &&
    canManage &&
    verifiedConnection &&
    (state === 'NOT_ENROLLED' || state === 'REVOKED');
  const canRevoke =
    pilotAvailable &&
    canManage &&
    (state === 'PENDING_REVIEW' || state === 'ACTIVE') &&
    Boolean(pilot?.enrollment_id);

  return (
    <section className={styles.card} aria-labelledby="pilot-title">
      <div className={styles.content}>
        <div className={styles.eyebrow}>AUTOMATION</div>
        <h2 id="pilot-title">AI sales assistant pilot</h2>
        <p className={styles.description}>
          Customer replies stay off until Kleva approves the merchant pilot,
          WhatsApp is verified, and AI responses are enabled. The assistant
          uses published business knowledge and hands off when it lacks enough
          evidence.
        </p>

        {!pilotAvailable ? (
          <p className={styles.notice} role="status">
            We could not verify pilot approval. Automation remains off until the
            backend confirms its status.
          </p>
        ) : !canManage ? (
          <p className={styles.notice} role="status">
            A business owner manages pilot approval and revocation.
          </p>
        ) : state === 'ACTIVE' && pilot?.assistant_ready ? (
          <div className={styles.active} role="status">
            <strong>Approved and ready</strong>
            <span>
              The backend confirms pilot approval, an active WhatsApp
              connection, and enabled AI responses. Human takeover still pauses
              automation for that conversation.
            </span>
          </div>
        ) : state === 'ACTIVE' ? (
          <p className={styles.notice} role="status">
            Pilot approval is active, but the backend has not confirmed that
            both WhatsApp and AI responses are ready. Check the connection above
            or contact Kleva support.
          </p>
        ) : state === 'PENDING_REVIEW' ? (
          <p className={styles.notice} role="status">
            Your request is awaiting Kleva review. AI customer replies remain
            off until approval is recorded.
          </p>
        ) : state === 'REVOKED' ? (
          <p className={styles.notice} role="status">
            Pilot access was revoked. Submit a new request if you want Kleva to
            review activation again.
          </p>
        ) : !verifiedConnection ? (
          <p className={styles.notice} role="status">
            Connect and verify WhatsApp above before requesting AI pilot
            activation.
          </p>
        ) : null}

        {result === 'requested' && (
          <p className={styles.success} role="status">
            Pilot request submitted. AI responses remain off while Kleva reviews
            it.
          </p>
        )}
        {result === 'revoked' && (
          <p className={styles.success} role="status">
            Pilot access was revoked. Pending AI work will recheck approval
            before sending.
          </p>
        )}
        {result === 'error' && (
          <p className={styles.error} role="alert">
            We could not update pilot access. Refresh this page and try again.
          </p>
        )}

        {canEnroll && (
          <form action={requestPilotReviewFromDashboard} className={styles.form}>
            <input type="hidden" name="businessId" value={businessId} />
            <input
              type="hidden"
              name="connectionId"
              value={connection?.id}
            />
            <label>
              <input
                type="checkbox"
                name="aiProviderDisclosureAccepted"
                required
              />
              I understand customer conversations may be processed by Kleva’s AI
              provider.
            </label>
            <label>
              <input
                type="checkbox"
                name="humanEscalationAccepted"
                required
              />
              I will provide a human escalation contact and review customer
              conversations when required.
            </label>
            <button className="button button-primary" type="submit">
              Request pilot activation
            </button>
          </form>
        )}

        {canRevoke && (
          <form action={revokePilotFromDashboard} className={styles.revokeForm}>
            <input type="hidden" name="businessId" value={businessId} />
            <input
              type="hidden"
              name="enrollmentId"
              value={pilot?.enrollment_id ?? ''}
            />
            <label>
              <input type="checkbox" name="confirmRevocation" required />
              I confirm I want to revoke AI pilot access for this business.
            </label>
            <button className="button button-secondary" type="submit">
              {state === 'ACTIVE' ? 'Revoke pilot access' : 'Withdraw request'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
