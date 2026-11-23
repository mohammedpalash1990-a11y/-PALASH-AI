# PALASH AI

Private, approval-gated command center for personal projects and business operations.

## Live deployment
- Dashboard and API: https://br-spring-meadow-bhyg1vo9-palashai.compute.c-10.eu-central-1.aws.neon.tech/
- Health endpoint: `/api/health`
- Runtime: Neon Functions, Node.js 24
- Database: Neon PostgreSQL 17, `palash_ai`, branch `production`

## Architecture
- Neon PostgreSQL: persistent users, projects, agents, tasks, approvals, settings and activity logs.
- Neon Functions: HTTP API and responsive dashboard.
- The repository is private. No paid service is configured.

## Owner sign-in
- Email: `owner@palash.ai`
- The initial password is provided separately in the deployment handoff. Do not commit it.
- Session token expires after 24 hours.

## Safety and current release scope
This release provides the command center, seven specialist-agent profiles, project tracking, task queue, approvals and activity history. It does not yet autonomously execute shell commands, modify repositories, deploy applications, run migrations, make payments, or send external messages. Those integrations require separately scoped credentials, tests and enforced approval checks before activation.

## Source bundle
`deploy/palashai-function.zip.b64` is the deployed function source bundle encoded as base64. Decode it to a ZIP to inspect or redeploy. `DATABASE_URL` is injected by Neon. Never commit `.env`, database URLs, owner passwords, API keys or JWT secrets.
