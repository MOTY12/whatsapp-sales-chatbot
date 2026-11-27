# Knowledge index cleanup runbook

## Current state

Old and superseded index generations are retained. Destructive generation cleanup is not implemented or enabled. The repository has no approved retention period for index chunks or evaluation artifacts, so operators must not delete index generations or chunks manually.

## Before cleanup is implemented

1. Obtain an approved retention and audit policy for the tenant data involved.
2. Define eligibility in terms of business, source revision, generation status, active references, evaluation references and age.
3. Prove active generations, currently published revisions and in-progress indexing/evaluation jobs are excluded.
4. Add a tenant-safe dry-run that reports counts only and requires operator authorization for deletion.
5. Test dry-run and delete against disposable PostgreSQL/pgvector with foreign tenant and active-generation fixtures.
6. Confirm backup and restore behavior before enabling any destructive action.

Until those controls exist, retention is manual by policy approval and no cleanup SQL is supplied here.
