# PALASH AI — Deployment & Operations Guide

## 1. Architecture Overview

- **Frontend**: React 19 + Vite 8 + Tailwind CSS v4 + `vite-plugin-pwa` (desktop command center + installable PWA).
- **Backend**: Express (`server.ts`) on port `3000`, serving Vite middleware in development and `dist/` in production.
- **AI Engine**: server-side `@google/genai` client. Model is configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`) and every call has a timeout (`GEMINI_TIMEOUT_MS`, default 45s).
- **Persistence**: atomic 7-table JSON store (`.data/palash-state.json`) plus optional Neon PostgreSQL 17 access through `DATABASE_URL` for read-only querying and schema inspection.

Separately, `deploy/` contains a standalone Neon Function build. See `docs/neon-function.md` — it does **not** share a schema with the Express app.

## 2. Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | **production** | Random 32+ character HMAC key. Production refuses to boot without it; development generates `.data/.jwt-secret`. |
| `ADMIN_EMAIL` | Recommended | Owner account email; takes precedence over the first-run claim screen. |
| `ADMIN_PASSWORD` | Recommended | Owner password. Changing it rotates the stored hash on next boot. |
| `GEMINI_API_KEY` | For AI features | Server-side key for the Chief Agent and six specialists. |
| `GEMINI_MODEL` | No | Model override (default `gemini-2.5-flash`). |
| `DATABASE_URL` | Optional | Neon PostgreSQL connection string. |
| `PGSSLMODE` | Recommended in prod | `verify-full` verifies the database certificate. |
| `GITHUB_TOKEN` | Optional | GitHub PAT for private repository inspection and branch analysis. |
| `PORT` | No | Default `3000`. |

Copy `.env.example` for the complete list, including timeouts and `PALASH_DATA_DIR`.

## 3. Verification & Build Commands

```bash
npm ci                # reproducible install from package-lock.json
npm run lint          # tsc --noEmit
npm test              # 39 tests: core logic + end-to-end HTTP API
npm run build         # production SPA bundle + PWA service worker
NODE_ENV=production npm start
```

CI (`.github/workflows/ci.yml`) runs lint, tests, and build on every push and pull request.

## 4. First boot

1. Start the server (`npm run dev` or `npm start`).
2. `curl -s localhost:3000/api/health` → `"status":"healthy"`, `agentsCount: 7`.
3. Open the app. With no `ADMIN_EMAIL`/`ADMIN_PASSWORD` and no stored owner, the UI shows the
   first-run claim screen; choose an email and a password of at least 8 characters.
4. With env-managed credentials, sign in directly instead — the claim screen is disabled.

## 5. Backups and restore

- `POST /api/system/backup` writes a verified snapshot to `.data/backups/backup-<timestamp>.json`
  (SHA-256 re-read from disk; retention 20 files).
- `GET /api/system/backups` lists snapshots with size, checksum, and timestamp.
- `POST /api/system/backups/:id/restore` with `{"confirm": true}` restores one.
- Copy `.data/` off the host for off-machine retention; the API only writes locally.

## 6. Safety governance

- `production_deploy`, `database_migration`, `database_deletion`, `payment_purchase`, and
  `external_message` always require an owner decision in **Approvals & Safety**.
- Connected project databases (Musafir Cafe POS, Saudi Fast Food POS, Deenverse, Bangladesh
  Marketplace) remain isolated; this build never executes migrations or drops schemas.
- **Emergency Stop** in the header halts every agent immediately and returns `423` for new work
  until operations are resumed.

## 7. Operating notes

- Run a single replica: the JSON store and the task progress timers are process-local.
- `.data/` is gitignored — it is the only durable state for the Express deployment.
- Task execution is simulated in this build; see the "Known limitations" section of `README.md`.
