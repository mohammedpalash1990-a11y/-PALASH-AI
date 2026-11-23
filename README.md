# PALASH AI

Private approval-gated command center for personal projects and business operations.

## Infrastructure
- Neon project: `palash-ai` (`restless-paper-54015099`)
- Region: Frankfurt (`aws-eu-central-1`)
- PostgreSQL 17, database `palash_ai`, production branch
- Core tables and seven specialist-agent records are present.
- Neon Function: `palashai`, latest deployment #4 is marked completed.

## Current status
The source is now bundled with esbuild, including `pg` and Neon Functions dependencies. GitHub Actions build succeeded and the bundled deployment ZIP is committed at `deploy/palashai-function-bundled.zip.b64`. Neon deployment #4 completed.

The live `/api/health` request currently returns HTTP 500. The database still contains seven agent records and zero owner users, projects, tasks, or approvals. The function's required runtime configuration must be checked in Neon Console: `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `JWT_SECRET`. Neon injects `DATABASE_URL` automatically; set or verify the owner email, password, and JWT secret in the Function's environment settings. Then invoke `/api/health`, sign in, and confirm the owner record and dashboard data.

Do not treat PALASH AI as operational until health check and owner sign-in pass.

## Safety and scope
This release is a command center and task tracker, not yet an autonomous execution agent. Shell execution, repository writes, production deployments, destructive migrations, payments, and external messages remain disabled until scoped credentials, integration tests, and owner approval enforcement are implemented.

Production deployments, destructive database operations, payments, and external messages must require explicit owner approval.

## Secrets
Never commit `.env`, database URLs, owner passwords, API keys, or JWT secrets. Configure runtime secrets only through Neon Function environment settings.

## Build and deployment files
- `.github/workflows/build-neon-function.yml` — bundles the function using GitHub Actions.
- `deploy/palashai-function.zip.b64` — first unbundled source archive.
- `deploy/palashai-function-v2.zip.b64` — corrected unbundled source archive.
- `deploy/palashai-function-bundled.zip.b64` — deployable, esbuild-bundled function archive.