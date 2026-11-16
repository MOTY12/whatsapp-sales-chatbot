# Incident response

1. **Triage:** record UTC time, release tag, affected service, tenant scope and safe error classifications. Preserve relevant structured logs and database metadata; avoid copying message bodies, credentials or webhook payloads into tickets.
2. **Contain:** for suspected credential exposure, disable/rotate the affected OIDC, Meta, DB, Redis, SSM, encryption or model credential and review access logs. Disconnect a compromised WhatsApp connection through the existing merchant/provider path. Restrict the affected tenant or endpoint if needed.
3. **AI/provider incident:** set `AI_RESPONSES_ENABLED=false`, restart API and worker with the same approved release, and verify inbox/manual operation. Do not delete AI run or usage records during investigation.
4. **Queue incident:** PostgreSQL outbox is authoritative. Restore DB/Redis connectivity and let the relay retry eligible records. Inspect attempt count, lease age, status and safe error class. Never resend `UNCERTAIN` WhatsApp effects until provider history has been reconciled.
5. **Data incident:** stop destructive writes, preserve the current DB snapshot and audit evidence, and involve the data owner. Restore only to an isolated `kleva_restore_*` database first. Production recovery requires an explicit incident decision and a separately reviewed procedure.
6. **Recover:** deploy a reviewed compatible release or forward migration, verify API/dashboard/worker health, tenant isolation and backlog drain, then re-enable pilot traffic/AI only after owner approval.
7. **Close:** document impact window, tenants affected, recovery evidence, follow-up owner and retention/deletion decisions. Notify merchants through the approved support channel when required by policy.
