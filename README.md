# PALASH AI

Private, approval-gated command center for personal projects and business operations.

## Architecture
- Neon PostgreSQL: persistent users, projects, agents, tasks, approvals, settings and activity logs.
- Neon Functions: Node.js 24 HTTP API and responsive dashboard.
- No paid service is configured.

## Safety
This initial release provides a command center and task/approval tracker. It does not autonomously execute shell commands, modify repositories, deploy applications, run migrations, make payments, or send external messages. Those integrations require separately scoped credentials and enforced approvals.

## Deployment
Deploy `deploy/palashai-function.zip.b64` as a Neon Function on the `production` branch. Decode the base64 file to a ZIP first. Neon injects `DATABASE_URL`; set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `JWT_SECRET` as function environment variables. Never commit secrets.
