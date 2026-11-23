# PALASH AI

Private approval-gated command center for personal projects and business operations.

## Infrastructure created
- Neon project: `palash-ai` (`restless-paper-54015099`)
- Region: Frankfurt (`aws-eu-central-1`)
- PostgreSQL 17, database `palash_ai`, branch `production`
- Seven specialist-agent records and core tables are present.
- Neon Function slug: `palashai`; deployment bundle is present in `deploy/`.

## Deployment status
The function deployment record is completed, but its HTTP endpoint has not passed verification (external health check returned HTTP 502). The database owner account was not initialized. Do not treat the dashboard as production-ready until function environment variables are restored and `/api/health` and owner sign-in pass.

## Safety and scope
The intended release includes the command center, project tracking, task queue, specialist-agent profiles, approvals and activity history. Shell execution, repository writes, production deployments, destructive migrations, payments and external messages must remain disabled until separately scoped credentials, integration tests and owner approval enforcement are in place.

## Secrets
Never commit `.env`, database URLs, owner passwords, API keys or JWT secrets. Neon injects `DATABASE_URL` into deployed functions. Configure owner credentials only through the function's secret environment settings.

## Source bundle
- `deploy/palashai-function.zip.b64` — first bundle
- `deploy/palashai-function-v2.zip.b64` — corrected template-escaping bundle

Decode a `.b64` bundle to ZIP before inspecting or redeploying.
