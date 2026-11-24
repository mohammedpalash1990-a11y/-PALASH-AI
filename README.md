# PALASH AI

Approval-gated command center for running a small portfolio of projects with a team of
specialist AI agents. Missions are planned by a Chief Agent, decomposed into tasks for
seven specialists, and every consequential action stops at an owner approval gate.

- React 19 + Vite 8 + Tailwind v4 front end (desktop command center + installable PWA)
- Express API (`server.ts`) that serves the SPA in development and production
- Server-side Gemini client (`@google/genai`) for planning, execution, chat, and code review
- Atomic 7-table JSON store (`.data/palash-state.json`), optionally paired with Neon Postgres

## Quick start

```bash
npm install
cp .env.example .env        # optional: add GEMINI_API_KEY for real AI planning
npm run dev                 # http://localhost:3000
```

On first boot there is no owner account, so the app opens the **first-run claim screen** —
pick any email and a password of at least 8 characters. That account owns the workspace.
Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` instead if you prefer env-managed credentials; they take
precedence over the claim screen and rotate the stored password when changed.

Without `GEMINI_API_KEY` the UI still works: projects, tasks, approvals, finance, monitoring,
backups, the SQL console, and emergency stop are all local. Mission planning, chat, and code
analysis return a clear "not configured" error instead of failing silently.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Express + Vite middleware with hot reload on port 3000 |
| `npm run build` | Production client bundle + PWA service worker into `dist/` |
| `npm start` | Production server (`NODE_ENV=production`, serves `dist/`) |
| `npm test` | 39 tests: core logic suites + end-to-end HTTP API tests |
| `npm run test:core` | Core logic suites only (fast, no server) |
| `npm run lint` | `tsc --noEmit` type check |

`npm start` requires `npm run build` first, plus `JWT_SECRET` (see below).

## Configuration

Everything is optional in development. The variables that matter:

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | **production** | HMAC signing key, 32+ chars. The server refuses to boot in production without it; in development it generates one and stores it at `.data/.jwt-secret`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | no | Env-managed owner credentials, overriding the first-run claim screen. |
| `GEMINI_API_KEY` | for AI features | Server-side Gemini key. Never exposed to the browser. |
| `GEMINI_MODEL` | no | Model id override (default `gemini-2.5-flash`). |
| `DATABASE_URL` | no | Neon/Postgres for read-only query proxying and schema inspection. |
| `PGSSLMODE` | no | `verify-full` to verify the database certificate; set this in production. |
| `GITHUB_TOKEN` | no | GitHub PAT for private repo inspection and branch analysis. |
| `PALASH_DATA_DIR` | no | Override the local state directory (default `./.data`). |

Full list with defaults: [`.env.example`](.env.example). Deployment notes: [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Architecture

```
src/                     React app (views, voice controller, PWA hooks)
server.ts                Express API + static/Vite host; all routes are here
server/aiEngine.ts       Gemini client: chief plan, specialist run, chat, code review
server/core/security.ts  Password hashing, HMAC tokens, rate limiter, approval policy matrix
server/core/sqlGuard.ts  Statement classifier for the read-only SQL console
server/core/orchestrator.ts  Canonical agent roster + task state machine
server/core/finance.ts   P&L, budget attainment, 30-day cash-flow projection
server/store.ts          Atomic JSON store, seed data, local read-only query engine
server/pgBridge.ts       Optional Postgres pool (health, tables, read-only queries)
server/githubService.ts  GitHub REST wrapper (inspect, files, PR proposals)
```

The approval policy is the heart of the product: `production_deploy`, `database_migration`,
`database_deletion`, `payment_purchase`, and `external_message` always require an owner
decision in the Approvals view before a task may execute. `branch_code_change` and
`test_execution` are restricted to sandbox/branch scope. Research, planning, and code
analysis run immediately.

## API surface

Auth: `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/me`.

Operations: `GET /api/health`, `/api/overview`, `/api/agents`, `/api/policies`,
`/api/audit-logs`, `/api/memory`, `/api/monitoring/metrics`, `/api/system/readiness`.

Work: `POST /api/missions/plan`, `GET|POST /api/tasks`, `POST /api/tasks/:id/execute`,
`POST /api/tasks/:id/retry`, `GET /api/tasks/live-progress`, `GET /api/tasks/:id/progress`,
`GET|POST /api/projects`, `PATCH /api/projects/:id`, `GET /api/approvals`,
`POST /api/approvals/:id/decide`.

Safety and data: `POST /api/system/emergency-stop` (`{active: true|false}`),
`POST /api/system/backup`, `GET /api/system/backups`,
`POST /api/system/backups/:id/restore` (requires `{"confirm": true}`),
`POST /api/database/query` (owner-only, read-only), `POST /api/database/migrate`,
`POST /api/database/bootstrap-pg`, `GET /api/database/tables`.

GitHub and finance: `POST /api/github/inspect`, `/api/github/files`, `/api/github/analyze`,
`/api/github/propose-pr`, `GET /api/finance/summary`, `POST /api/finance/entries`.

All mutating endpoints require a Bearer token; consequential ones also require the `owner` role.

## Safety model

- Owner sessions are signed HMAC tokens with a 12-hour expiry; the header algorithm is pinned
  to `HS256` and rejected otherwise.
- The front end keeps the token in memory only (no `localStorage`), so a refresh signs you out.
- Credential endpoints are throttled per IP *and* per account (10 attempts / 5 minutes).
- The SQL console classifier strips comments and masks string literals, then blocks stacked
  statements, writable CTEs, `SELECT ... INTO`, `EXPLAIN ANALYZE`, and filesystem/replication
  functions (`pg_read_file`, `dblink`, `pg_sleep`, …). Raw SQL stays owner-only.
- Backups write a real snapshot file to `.data/backups/` with a SHA-256, verified by reading it
  back; restore requires an explicit `confirm` flag.
- Emergency stop halts every agent and refuses new work until it is cleared.

## Known limitations

- Execution is **simulated**: `/api/tasks/:id/execute` walks progress stages and records an
  agent report. No shell commands, repository writes, deployments, migrations, payments, or
  outbound messages are performed by this build — those paths only create approval records.
- The store is a single JSON file guarded by an in-process lock. It is fine for one instance;
  run a single replica or move to Postgres before scaling horizontally.
- The task queue is in-process (`setTimeout` stages); a restart loses in-flight progress.
- Voice commands are a keyword parser over a supplied transcript; browser speech recognition
  is opt-in and not exercised by the test suite.

## Neon Function deployment

The repository also carries a dependency-free Neon Function build under `deploy/` that shares
the same Postgres schema but not the React UI. See
[`docs/neon-function.md`](docs/neon-function.md) before deploying it — the two runtimes must not
point at the same database with different expectations.
