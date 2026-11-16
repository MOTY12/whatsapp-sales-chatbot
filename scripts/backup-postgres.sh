#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export AWS_PAGER=""

required=(BACKUP_DATABASE_HOST BACKUP_DATABASE_PORT BACKUP_DATABASE_USER BACKUP_DATABASE_PASSWORD BACKUP_DATABASE_NAME DATABASE_SSL_CA_FILE AGE_BACKUP_RECIPIENT S3_BUCKET AWS_REGION DEPLOYMENT_ENV)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'event=backup_failed classification=missing_configuration variable=%s\n' "$name" >&2
    exit 2
  fi
done

if [[ ! -r "$DATABASE_SSL_CA_FILE" ]]; then
  printf 'event=backup_failed classification=database_ca_unavailable\n' >&2
  exit 2
fi
if [[ "$DEPLOYMENT_ENV" != staging && "$DEPLOYMENT_ENV" != production ]]; then
  printf 'event=backup_failed classification=invalid_environment\n' >&2
  exit 2
fi

workdir=$(mktemp -d "${TMPDIR:-/tmp}/kleva-backup.XXXXXX")
cleanup() { rm -rf "$workdir"; }
failed() {
  status=$?
  if [[ $status -ne 0 ]]; then
    printf 'event=backup_failed classification=command_failed\n' >&2
  fi
  cleanup
  exit "$status"
}
trap failed EXIT

export PGSSLMODE=verify-full
export PGSSLROOTCERT="$DATABASE_SSL_CA_FILE"
PGPASSWORD="$BACKUP_DATABASE_PASSWORD" pg_dump \
  --host "$BACKUP_DATABASE_HOST" --port "$BACKUP_DATABASE_PORT" \
  --username "$BACKUP_DATABASE_USER" --dbname "$BACKUP_DATABASE_NAME" \
  --format=custom --no-owner --no-acl --file "$workdir/kleva.dump"
age --recipient "$AGE_BACKUP_RECIPIENT" --output "$workdir/kleva.dump.age" "$workdir/kleva.dump"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
day=$(date -u +%d)
retention_class=daily
if [[ "$day" == 01 ]]; then retention_class=monthly; fi
object="s3://${S3_BUCKET}/kleva/${DEPLOYMENT_ENV}/${retention_class}/${stamp}-kleva.dump.age"

if [[ -n "${S3_KMS_KEY_ID:-}" ]]; then
  aws s3 cp "$workdir/kleva.dump.age" "$object" \
    --region "$AWS_REGION" --sse aws:kms --sse-kms-key-id "$S3_KMS_KEY_ID"
else
  aws s3 cp "$workdir/kleva.dump.age" "$object" \
    --region "$AWS_REGION" --sse aws:kms
fi
printf 'event=backup_succeeded environment=%s retention_class=%s object=%s\n' \
  "$DEPLOYMENT_ENV" "$retention_class" "$object"
