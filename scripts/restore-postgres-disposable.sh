#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

required=(RESTORE_TARGET_KIND RESTORE_DATABASE_NAME DATABASE_HOST DATABASE_PORT DATABASE_USER DATABASE_PASSWORD DATABASE_SSL_CA_FILE AGE_IDENTITY_FILE BACKUP_FILE)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Restore refused: set %s.\n' "$name" >&2
    exit 2
  fi
done

if [[ "$RESTORE_TARGET_KIND" != disposable || ! "$RESTORE_DATABASE_NAME" =~ ^kleva_restore_[a-zA-Z0-9_]+$ ]]; then
  printf 'Restore refused: target must be a disposable database named kleva_restore_*.\n' >&2
  exit 2
fi
if [[ ! -r "$DATABASE_SSL_CA_FILE" || ! -r "$AGE_IDENTITY_FILE" || ! -r "$BACKUP_FILE" ]]; then
  printf 'Restore refused: CA, age identity, or encrypted backup is unreadable.\n' >&2
  exit 2
fi

export PGPASSWORD="$DATABASE_PASSWORD"
export PGSSLMODE=verify-full
export PGSSLROOTCERT="$DATABASE_SSL_CA_FILE"
age --decrypt --identity "$AGE_IDENTITY_FILE" "$BACKUP_FILE" |
  pg_restore --host "$DATABASE_HOST" --port "$DATABASE_PORT" \
    --username "$DATABASE_USER" --dbname "$RESTORE_DATABASE_NAME" \
    --format=custom --clean --if-exists --single-transaction \
    --exit-on-error --no-owner --no-acl
printf 'event=restore_succeeded target=%s\n' "$RESTORE_DATABASE_NAME"
