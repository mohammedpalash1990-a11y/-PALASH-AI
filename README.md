# PALASH AI

Private approval-gated command center for personal projects and business operations.

## Infrastructure created
- Neon project: `palash-ai` (`restless-paper-54015099`)
- Region: Frankfurt (`aws-eu-central-1`)
- PostgreSQL 17, database `palash_ai`, production branch
- Core tables and seven specialist-agent records are present.
- Neon Function slug: `palashai`

## Current deployment blocker
The latest Neon Function deployment failed to load because the uploaded ZIP was not bundled: the runtime cannot resolve the external `pg` package. The earlier unbundled ZIPs are not deployable. The database currently has seven agent records but zero owner users, projects, tasks, or approvals. The dashboard is not operational.

A GitHub Actions workflow, `.github/workflows/build-neon-function.yml`, has been added to install dependencies, bundle the Node.js 24 function with esbuild, and upload a ZIP artifact. The workflow has not yet produced a verified artifact. After the bundled ZIP is available, redeploy the function and verify `/api/health`, owner sign-in, and the initial database records.

## Safety and scope
This release is a command center and task tracker, not yet an autonomous execution agent. Shell execution, repository writes, production deployments, destructive migrations, payments, and external messages remain disabled until scoped credentials, integration tests, and owner approval enforcement are implemented.

Production deployments, destructive database operations, payments, and external messages must require explicit owner approval.

## Secrets
Never commit `.env`, database URLs, owner passwords, API keys, or JWT secrets. Configure `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `JWT_SECRET` only through Neon Function environment settings.

## Source bundle
- `deploy/palashai-function.zip.b64` — first unbundled source archive
- `deploy/palashai-function-v2.zip.b64` — corrected source archive, also unbundled

These source archives must be bundled with esbuild before deployment.