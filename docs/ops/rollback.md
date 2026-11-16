# Deployment rollback and forward recovery

Keep the last known-good immutable image tags for API/worker and dashboard. Before a rollout, capture a verified backup, record current migration version and check compatibility notes. Start new images only after additive migrations and least-privilege grants complete.

If the release fails before schema changes, stop the new stack and restore the prior image tags. If additive migrations are backward-compatible, the previous application images may be restored while keeping the expanded schema. Verify readiness, worker heartbeat, outbox age, dashboard login and safe error rates before reopening pilot traffic.

For a breaking or partially applied migration, do not run TypeORM revert automatically and do not drop production data. Keep traffic restricted, retain the failed state and logs, then prepare a corrective forward migration. If data recovery is necessary, restore a backup to an isolated database and compare/validate it before a separately authorized production recovery. Record the decision and tested evidence.

The Compose manifest provides restart-on-failure behavior; it does not perform blue/green deployment. Traffic cutover is a controlled operator action after health checks.
