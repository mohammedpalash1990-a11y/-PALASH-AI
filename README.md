# PALASH AI

Private approval-gated command center for personal projects and business operations.

## Infrastructure
- Neon project: `palash-ai` (`restless-paper-54015099`)
- Region: Frankfurt (`aws-eu-central-1`)
- PostgreSQL 17, database `palash_ai`, production branch
- Core tables and seven specialist-agent records are present.
- Neon Function: `palashai`, latest deployment #4 is marked completed.

## Build and deployment
The GitHub Actions build succeeded. It bundles the Node.js 24 function with esbuild, including `pg` and Neon Functions dependencies. The deployable ZIP is committed at `deploy/palashai-function-bundled.zip.b64`. Neon deployment #4 completed.

## Runtime status — not operational yet
The live `/api/health` endpoint returns HTTP 500. Neon Function logs identify the exact cause: `Required environment is missing`. The deployment has no configured application environment values. Neon supplies the database connection binding, but the application still needs its owner bootstrap and signing secrets.

Required Function environment values:
- `ADMIN_EMAIL` — owner login email.
- `ADMIN_PASSWORD` — strong initial owner password.
- `JWT_SECRET` — long random signing secret.

Set these in Neon Console → Functions → `palashai` → Environment, then redeploy the latest bundled ZIP. Never put these values in GitHub or chat. After redeployment, verify `/api/health`, owner sign-in, and database initialization.

Current database counts: 0 users, 7 agents, 0 projects, 0 tasks, 0 approvals. The dashboard is not yet usable. Do not treat PALASH AI as operational until health check, owner sign-in, and database initialization pass.

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