import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options';
import { errorCode } from '../config/logging';

const rolePattern = /^kleva_commercial_operator_[a-z0-9_]{1,40}$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/;

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function positiveInteger(value: string, label: string, zero = false): number {
  if (!/^(0|[1-9]\d{0,9})$/.test(value))
    throw new Error(`${label} is invalid.`);
  const number = Number(value);
  if ((!zero && number < 1) || number > 2_147_483_647)
    throw new Error(`${label} is outside the supported range.`);
  return number;
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  const username = process.env.COMMERCIAL_OPERATOR_DATABASE_USER?.trim();
  const password = process.env.COMMERCIAL_OPERATOR_DATABASE_PASSWORD;
  if (!username || !rolePattern.test(username) || !password?.trim())
    throw new Error(
      'Configure an individually provisioned commercial operator database login.',
    );

  const source = new DataSource({ ...databaseOptions(), username, password });
  try {
    await source.initialize();
    let result: unknown;
    switch (command) {
      case 'capacity-set': {
        if (args.length !== 8)
          throw new Error('capacity-set expects eight integer limits.');
        const values = args.map((value, i) =>
          positiveInteger(value, `Limit ${i + 1}`, i !== 0 && i !== 3),
        );
        [result] = await source.query(
          'SELECT public.kleva_commercial_capacity_set($1,$2,$3,$4,$5,$6,$7,$8) AS updated',
          values,
        );
        break;
      }
      case 'package-create':
      case 'package-version': {
        const expected = 10;
        if (args.length !== expected)
          throw new Error(`${command} received an invalid argument count.`);
        const packageKeyOrId = args[0];
        if (command === 'package-version' && !uuid.test(packageKeyOrId))
          throw new Error('Package id is invalid.');
        const name = args[1];
        const description = args[2];
        const price = args[3];
        const period = args[4];
        const days = positiveInteger(args[5], 'Pilot days');
        const channels = args[6].split(',');
        const allowances = parseObject(args[7], 'Allowances');
        const perRequest = positiveInteger(
          args[8],
          'Per-request AI token limit',
          true,
        );
        const support = parseObject(args[9], 'Support coverage');
        if (
          !name ||
          name.length > 120 ||
          description.length > 2000 ||
          !money.test(price) ||
          !['PILOT', 'MONTHLY'].includes(period)
        )
          throw new Error('Package terms are invalid.');
        if (
          !channels.length ||
          channels.some(
            (channel) => !['WEBSITE', 'WHATSAPP'].includes(channel),
          ) ||
          new Set(channels).size !== channels.length
        )
          throw new Error('Channels must be WEBSITE, WHATSAPP, or both.');
        const call =
          command === 'package-create'
            ? 'SELECT public.kleva_commercial_create_package($1,$2,$3,$4::numeric,$5,$6,$7,$8::jsonb,$9,$10::jsonb) AS result'
            : 'SELECT public.kleva_commercial_package_version_create($1,$2,$3,$4::numeric,$5,$6,$7,$8::jsonb,$9,$10::jsonb) AS result';
        const values =
          command === 'package-create'
            ? [
                packageKeyOrId,
                name,
                description,
                price,
                period,
                days,
                channels,
                JSON.stringify(allowances),
                perRequest,
                JSON.stringify(support),
              ]
            : [
                packageKeyOrId,
                name,
                description,
                price,
                period,
                days,
                channels,
                JSON.stringify(allowances),
                perRequest,
                JSON.stringify(support),
              ];
        [result] = await source.query(call, values);
        break;
      }
      case 'package-approve':
        if (args.length !== 1 || !uuid.test(args[0]))
          throw new Error('package-approve expects a version UUID.');
        [result] = await source.query(
          'SELECT public.kleva_commercial_package_approve($1) AS approved',
          args,
        );
        break;
      case 'offer-create':
        if (
          args.length !== 5 ||
          !uuid.test(args[0]) ||
          !uuid.test(args[1]) ||
          !uuid.test(args[2])
        )
          throw new Error(
            'offer-create expects business UUID, package version UUID, request UUID, agreement version, support owner.',
          );
        [result] = await source.query(
          'SELECT public.kleva_commercial_offer_create($1,$2,$3,$4,$5) AS enrollment_id',
          args,
        );
        break;
      case 'offer-approve':
        if (
          args.length !== 2 ||
          !uuid.test(args[0]) ||
          !Number.isFinite(Date.parse(args[1]))
        )
          throw new Error(
            'offer-approve expects enrollment UUID and ISO pilot start timestamp.',
          );
        [result] = await source.query(
          'SELECT public.kleva_commercial_approve($1,$2::timestamptz) AS approved',
          args,
        );
        break;
      case 'offer-activate':
        if (args.length !== 1 || !uuid.test(args[0]))
          throw new Error('offer-activate expects an enrollment UUID.');
        [result] = await source.query(
          'SELECT public.kleva_commercial_activate($1) AS activated',
          args,
        );
        break;
      case 'invoice-create':
        if (
          args.length !== 4 ||
          !uuid.test(args[0]) ||
          !identifier.test(args[1]) ||
          !Number.isFinite(Date.parse(args[2]))
        )
          throw new Error(
            'invoice-create expects enrollment UUID, unique reference, due timestamp, and description.',
          );
        [result] = await source.query(
          'SELECT public.kleva_commercial_invoice_create($1,$2,$3::timestamptz,$4) AS invoice_id',
          args,
        );
        break;
      case 'invoice-issue':
        if (args.length !== 1 || !uuid.test(args[0]))
          throw new Error('invoice-issue expects an invoice UUID.');
        [result] = await source.query(
          'SELECT public.kleva_commercial_invoice_issue($1) AS issued',
          args,
        );
        break;
      case 'payment-record':
        if (
          args.length !== 7 ||
          !uuid.test(args[0]) ||
          !money.test(args[1]) ||
          ![
            'BANK_TRANSFER',
            'EXTERNAL_REFERENCE',
            'MANUAL_GATEWAY_CONFIRMATION',
          ].includes(args[2]) ||
          !identifier.test(args[3]) ||
          !identifier.test(args[4]) ||
          !Number.isFinite(Date.parse(args[5]))
        )
          throw new Error(
            'payment-record expects invoice UUID, exact amount, method, reference scope, external reference, received timestamp and evidence reference.',
          );
        [result] = await source.query(
          'SELECT public.kleva_commercial_payment_record($1,$2::numeric,$3,$4,$5,$6::timestamptz,$7) AS payment_id',
          args,
        );
        break;
      case 'payment-confirm':
        if (args.length !== 1 || !uuid.test(args[0]))
          throw new Error('payment-confirm expects a payment UUID.');
        [result] = await source.query(
          'SELECT public.kleva_commercial_payment_confirm($1) AS confirmed',
          args,
        );
        break;
      case 'payment-reverse':
        if (args.length !== 2 || !uuid.test(args[0]))
          throw new Error(
            'payment-reverse expects payment UUID and a documented reason.',
          );
        [result] = await source.query(
          'SELECT public.kleva_commercial_payment_reverse($1,$2) AS reversed',
          args,
        );
        break;
      case 'entitlement-provision':
        if (args.length !== 2 || !uuid.test(args[0]) || !uuid.test(args[1]))
          throw new Error(
            'entitlement-provision expects enrollment UUID and stable idempotency UUID.',
          );
        [result] = await source.query(
          'SELECT public.kleva_commercial_provision($1,$2) AS provisioned',
          args,
        );
        break;
      default:
        throw new Error(
          'Supported commands: capacity-set, package-create, package-version, package-approve, offer-create, offer-approve, offer-activate, invoice-create, invoice-issue, payment-record, payment-confirm, payment-reverse, entitlement-provision.',
        );
    }
    console.log(
      JSON.stringify({
        event: 'commercial.operator.command_completed',
        command,
        result,
      }),
    );
  } catch (error) {
    const code = errorCode(error);
    console.error(
      code
        ? `Commercial operation failed (${code}). Review operator permission and record state.`
        : error instanceof Error
          ? error.message
          : 'Commercial operation failed.',
    );
    process.exitCode = 1;
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

void run().catch(() => {
  console.error(
    'Commercial operator command could not start. Check operator configuration and migration state.',
  );
  process.exitCode = 1;
});
