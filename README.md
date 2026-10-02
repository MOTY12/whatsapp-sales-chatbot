# Kleva WhatsApp Sales Assistant

Kleva is a NestJS and PostgreSQL backend for WhatsApp business onboarding, inbound lead capture, and owner-facing assistant commands. WhatsApp is the product interface. This repository does not include a customer dashboard.

## Local setup

```bash
npm install
cp .env.example .env
createdb -U postgres kleva_db
npm run migration:run
npm run start:dev
```

The API listens on `PORT` (default 3000). Copy `.env.example` and replace every `replace_me` value before connecting Meta.

Required for local boot:

- PostgreSQL connection settings (`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`)

Required for real WhatsApp traffic:

- `WHATSAPP_VERIFY_TOKEN`
- `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
- `WHATSAPP_BUSINESS_CONFIG_ID`
- `WHATSAPP_API_VERSION`

`WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are a development fallback. Connected businesses use the Meta access token and phone-number ID stored on the business record.

Redis and OpenAI variables are listed for later milestones. Milestone 0 does not start a worker process and does not call OpenAI.

## Webhook configuration

Set Meta's callback URL to `https://your-public-url/webhooks/whatsapp`.

- GET uses `WHATSAPP_VERIFY_TOKEN` for the subscription challenge.
- POST requires `X-Hub-Signature-256`. Kleva verifies it against `META_APP_SECRET` using the unmodified raw request body (`rawBody: true` in `src/main.ts`).

Inbound text events are resolved by Meta `phone_number_id`. Provider message IDs are unique in PostgreSQL so webhook retries do not duplicate messages.

## Database and migrations

```bash
npm run migration:run
npm run migration:revert
```

Migrations create the baseline schema and then add webhook/onboarding persistence fields (nullable WhatsApp connection columns, indexed owner WhatsApp IDs, unique provider message IDs, and `onboarding_sessions`).

Local development still allows TypeORM `synchronize` when `NODE_ENV` is not `production`. Production must run migrations and keep synchronize disabled.

See `DATABASE_SETUP.md` for PostgreSQL details.

## Workers

BullMQ/Redis workers for follow-ups and the daily brief are not implemented yet. Do not start a separate worker process. `npm run start:dev` runs the HTTP application only.

## Scripts

```bash
npm run start:dev
npm run build
npm run lint:check
npm test -- --runInBand
npm run test:e2e
npm run migration:run
```

## MVP boundary

No web dashboard, payments, inventory, broadcasts, or public CRM API. Assistant CRM, reminders, and sales stores are still in-memory and will be replaced in later milestones.
