import 'dotenv/config';
import { DataSource } from 'typeorm';
import { errorCode } from '../config/logging';
import { databaseOptions } from './options';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rolePattern = /^kleva_pilot_operator_[a-z0-9_]{1,40}$/;
const evidencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$/;

async function approve() {
  const [enrollmentId, evidenceReference, ...extra] = process.argv.slice(2);
  const username = process.env.PILOT_OPERATOR_DATABASE_USER?.trim();
  const password = process.env.PILOT_OPERATOR_DATABASE_PASSWORD;
  if (
    extra.length ||
    !enrollmentId ||
    !uuid.test(enrollmentId) ||
    !evidenceReference ||
    !evidencePattern.test(evidenceReference) ||
    !username ||
    !rolePattern.test(username) ||
    !password?.trim()
  ) {
    console.error(
      'Usage: npm run pilot:approve -- <pending-enrollment-uuid> <approval-ticket-reference> with the operator database login configured.',
    );
    process.exitCode = 1;
    return;
  }

  const source = new DataSource({
    ...databaseOptions(),
    username,
    password,
  });
  try {
    await source.initialize();
    const rows = await source.query<
      {
        enrollment_id: string;
        business_id: string;
        connection_id: string;
        status: string;
        activated_at: Date;
        activated_by: string;
        activation_reference: string;
      }[]
    >('SELECT * FROM public.kleva_pilot_activate($1,$2)', [
      enrollmentId,
      evidenceReference,
    ]);
    if (rows.length !== 1) {
      console.error(
        'No pending enrollment matched an active business and its verified WhatsApp connection.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      JSON.stringify({ event: 'pilot.enrollment_activated', ...rows[0] }),
    );
  } catch (error) {
    const code = errorCode(error);
    console.error(
      code
        ? `Pilot approval failed (${code}). Check operator authorization and the enrollment state.`
        : 'Pilot approval failed. Check operator authorization, database configuration, and migrations.',
    );
    process.exitCode = 1;
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

void approve();
