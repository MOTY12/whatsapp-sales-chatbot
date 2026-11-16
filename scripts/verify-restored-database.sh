#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${RESTORE_TARGET_KIND:-}" != disposable || ! "${RESTORE_DATABASE_NAME:-}" =~ ^kleva_restore_[a-zA-Z0-9_]+$ ]]; then
  printf 'Verification refused: use a kleva_restore_* disposable database.\n' >&2
  exit 2
fi

export PGPASSWORD="${DATABASE_PASSWORD:?Set DATABASE_PASSWORD}"
export PGSSLMODE=verify-full
export PGSSLROOTCERT="${DATABASE_SSL_CA_FILE:?Set DATABASE_SSL_CA_FILE}"
psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --host "${DATABASE_HOST:?Set DATABASE_HOST}" \
  --port "${DATABASE_PORT:-5432}" \
  --username "${DATABASE_USER:?Set DATABASE_USER}" \
  --dbname "$RESTORE_DATABASE_NAME" \
  --command "SELECT current_database(), count(*) AS migration_rows FROM public.migrations; SELECT to_regclass('public.ai_response_runs') IS NOT NULL AS has_ai_runs, to_regclass('public.whatsapp_outbound_messages') IS NOT NULL AS has_outbound, to_regclass('public.merchant_leads') IS NOT NULL AS has_leads;"
