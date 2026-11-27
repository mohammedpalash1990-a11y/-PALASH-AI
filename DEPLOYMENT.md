# PALASH AI — Deployment & Operations

## Production topology

- Frontend: Cloudflare Pages project palash-ai at https://palash-ai.pages.dev.
- Pages API proxy: functions/api/[[path]].ts forwards same-origin /api/* requests to the configured NEON_API_URL binding.
- Backend: Neon Function palashai, Node.js 24 runtime.
- Persistent workspace: Neon project restless-paper-54015099, branch br-spring-meadow-bhyg1vo9, database palash_ai.
- Source repository: mohammedpalash1990-a11y/-PALASH-AI, branch main.

Do not point this application at another project's database. Do not delete or reset the Neon branch or workspace state as part of routine deployment.

## Required configuration

### Neon Function environment

| Variable | Required | Purpose |
| --- | --- | --- |
| DATABASE_URL | Yes | Connection string for the PALASH AI Neon database. |
| GEMINI_API_KEY | Yes | Primary AI provider key. |
| GEMINI_MODEL | Recommended | Preferred Gemini model identifier; the deployed bundle includes model fallback attempts. |
| APP_URL | Recommended | Public application URL used in callback/status metadata. |
| OPENAI_API_KEY | Optional | Enables OpenAI API fallback after Gemini attempts fail. |
| OPENAI_MODEL | Optional | OpenAI Responses API model; defaults to gpt-4.1-mini. |
| GITHUB_TOKEN | Optional | Server-side GitHub token; alternatively connect a scoped token in GitHub Engineering. |

The latest inspected Neon deployment (deployment 49) listed DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL, OPENAI_MODEL, and APP_URL. It did not list OPENAI_API_KEY; OpenAI fallback is therefore not verified as configured. Environment values are secret and are not printed here.

### Cloudflare Pages

Configure NEON_API_URL as a Pages environment variable/binding for both Production and Preview environments. Its value must be the PALASH AI Neon Function invocation URL. Do not put the database URL or AI provider keys in the frontend environment.

### GitHub Actions secrets

The daily backup workflow requires NEON_API_KEY as a repository Actions secret. Keep it secret and grant only the permissions required for the Neon API.

## CI/CD

The workflow .github/workflows/build-neon-function.yml runs on changes to the function bundle, package manifest, or workflow file. It performs dependency installation, core/security tests (npm test), TypeScript validation (npm run lint), frontend production build (npm run build), Neon function bundle assembly, and deployment.

The inspected run for commit 249021ae73c78d26772602946a9e14181b326b49 completed successfully. Neon Function deployment 49 completed successfully. Cloudflare Pages production deployment for the same commit also completed successfully.

## Local checks

~~~bash
npm install --legacy-peer-deps
npm test
npm run lint
npm run build
npm run dev
~~~

The local Express development server in server.ts is used by npm run dev. Production API traffic is routed through Cloudflare Pages to the Neon Function bundle. Keep the two API implementations aligned when changing routes or behavior.

## Health and readiness verification

1. Open the production site and sign in as Owner.
2. Check Command Overview for API/database health.
3. Open Monitoring & Audit and review every readiness blocker.
4. Check GitHub connection and repository permission status.
5. Check each social integration from Agents & Queue.
6. Send a harmless chat message and verify a non-empty reply.
7. Create a low-risk test task and verify its final task status.
8. Verify that high-risk operations remain pending until Owner approval.
9. Create a workspace snapshot and confirm checksum integrity.

A successful CI build and deployment are not a substitute for an authenticated end-to-end test. Never report a provider action as successful until its response/status has been checked.

## Backup and recovery

- In-app snapshots are stored in palash_ai_backups inside the same Neon database.
- .github/workflows/neon-daily-backup.yml runs daily at 02:17 UTC.
- The workflow creates a checksum-verified snapshot and inserts it into Neon.
- If the GitHub repository is private, it also uploads a GitHub Actions artifact with 30-day retention. The workflow skips that independent artifact when the repository is public.
- Google Drive and Cloudflare R2 replication are not configured.
- Restore is a critical operation and must pass the Owner approval flow.

Do not delete older backups until a separate recovery test confirms a newer snapshot can be restored.

## Security and operating boundaries

- Keep the GitHub repository private.
- Never commit API keys, PATs, passwords, JWT secrets, or database connection strings.
- Use least-privilege GitHub/provider tokens.
- Social credentials are encrypted before storage in Neon.
- Public social publishing requires approval of the exact preview.
- Production deploys, database migrations/restores/deletions, payments, and external messages remain approval-gated or blocked when no executor is configured.
- Use Emergency Stop to halt agent execution.

See USER-MANUAL.md for Owner workflows.
