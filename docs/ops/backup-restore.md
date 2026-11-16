# Backup and restore

## Backup design

`scripts/backup-postgres.sh` uses a dedicated read-only `kleva_backup` login over verified PostgreSQL TLS, creates a custom-format dump, encrypts it client-side with age, then uploads it to S3 with SSE-KMS. Daily dumps use `kleva/<environment>/daily/`; the first of each month also creates a monthly recovery point. Configure bucket versioning, block public access, encryption, least-privilege VM access, and `deploy/s3-lifecycle.json`. The backup identity must not be usable by the API or migration job.

Install `deploy/kleva-backup.service` and `.timer`, set root-owned `/etc/kleva/backup.env` mode 0600, enable the timer, then inspect `systemctl list-timers kleva-backup.timer` and journald for `backup_succeeded` / `backup_failed`. Schedule is 02:00 UTC plus up to 45 minutes random delay. A failed command exits nonzero and emits a safe classification. Wire that unit result to the host monitoring alert.

## Disposable restore procedure

1. Create a fresh database whose name begins `kleva_restore_` on an isolated disposable PostgreSQL instance. Never use the active database or production hostname.
2. Fetch one encrypted object and the matching age identity through restricted operator access. Supply `RESTORE_TARGET_KIND=disposable`, `RESTORE_DATABASE_NAME=kleva_restore_<id>`, the isolated DB connection, TLS CA, identity file and backup file.
3. Run `scripts/restore-postgres-disposable.sh`, then `scripts/verify-restored-database.sh`. The script refuses any target not named `kleva_restore_*` and uses TLS verification and a single restore transaction.
4. Verify migrations and representative schema presence, tenant RLS/role state, and application read-only smoke checks. Record dump timestamp, restore duration, verification result and operator in the execution log. Destroy the disposable instance after evidence capture.

No AWS credentials or encrypted object were available during repository preparation. A local PostgreSQL 16 custom-format dump/restore of a tiny disposable fixture database succeeded; the command completed in under one second (reported as 0 seconds). This validates the local `pg_dump`/`pg_restore` path only. It did not exercise age encryption, S3 upload/download, KMS, IAM, or a representative application database. No RPO or RTO is claimed until repeated timed restores and a measured backup interval are available. With one successful daily backup, the nominal exposure is up to the time since that backup, but that is not a tested recovery-point guarantee.
