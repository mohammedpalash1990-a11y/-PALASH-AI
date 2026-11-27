# PALASH AI

PALASH AI is an owner-operated AI command center for project coordination, agent chat and tasks, GitHub engineering workflows, approvals and safety, finance tracking, database inspection, monitoring, and selected social publishing integrations.

Production: https://palash-ai.pages.dev

## Start here

- [User Manual](USER-MANUAL.md) — sign-in, navigation, chat commands, tasks, approvals, GitHub, social integrations, database, finance, backups, and limitations.
- [Deployment & Operations](DEPLOYMENT.md) — architecture, required configuration, CI/CD, health checks, and backup operations.
- [Social Integrations](SOCIAL-INTEGRATIONS.md) — provider scopes, supported actions, and publishing safety.
- [Security Policy](SECURITY.md) — credential handling and approval boundaries.

## Current architecture

- Frontend: React 19 + Vite + Tailwind CSS, deployed on Cloudflare Pages.
- Backend: Node.js 24 Neon Function, exposed to the Pages frontend through the NEON_API_URL binding.
- Persistent workspace: Neon PostgreSQL project restless-paper-54015099, branch br-spring-meadow-bhyg1vo9, database palash_ai.
- AI: Gemini API; optional OpenAI API fallback when OPENAI_API_KEY is configured in the Neon Function environment.
- PWA: installable web application on supported browsers.

## Local development

Prerequisites: Node.js 24 and npm.

~~~bash
npm install --legacy-peer-deps
npm run dev
~~~

Set server-side values in an untracked .env.local file. Start with .env.example. Never commit secrets.

## Verification

~~~bash
npm test
npm run lint
npm run build
~~~

A passing local build or CI workflow confirms code checks; it does not prove that every third-party account is connected or every external action is operational. Use the in-app Monitoring & Audit readiness report and verify each provider action independently.

## Safety

Production deployment, database migration/restore/deletion, payments, external messages, social publishing, and controlled GitHub writes are approval-gated. Use Emergency Stop to halt agent execution. Read the User Manual before connecting external accounts or approving actions.
