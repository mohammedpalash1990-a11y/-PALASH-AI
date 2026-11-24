# Security

PALASH AI is a private, single-owner workspace. Treat the deployment as an admin console.

## Repository hygiene

- Keep this repository private.
- Never commit `.env`, passwords, API keys, database URLs, JWT secrets, or customer data.
  `.gitignore` already excludes `.env*` (except `.env.example`), `.data/`, and build output.

## Sessions

- Owner sessions are HMAC-SHA256 bearer tokens with a **12-hour** expiry.
- The token header must be exactly `{"alg":"HS256","typ":"JWT"}`; tokens with any other
  algorithm (including `alg: none`) are rejected before the signature is checked.
- `JWT_SECRET` must be a random 32+ character value in production — the server refuses to
  start without it. In development a secret is generated once and stored at
  `.data/.jwt-secret` (mode 0600) so restarts do not sign everyone out.
- The browser keeps the token in memory only; refreshing the page signs the user out.
  The Neon Function build is the exception (it uses `localStorage`) — see
  `docs/neon-function.md`.

## Credentials

- Passwords are stored as `scrypt(password, salt, 64)` in the form `salt:hash` and verified
  with `timingSafeEqual`.
- The env-managed owner password is compared in constant time; rotating `ADMIN_PASSWORD`
  rotates the stored hash on the next boot.
- `/api/auth/setup` and `/api/auth/login` are throttled to 10 attempts per 5 minutes per IP
  **and** per account, and the limiter tracks at most a sliding window of keys.
- Rate limits key off `req.ip` resolved through exactly one trusted proxy hop, so a
  client-supplied `X-Forwarded-For` cannot mint fresh buckets.

## Approval gates

`production_deploy`, `database_migration`, `database_deletion`, `payment_purchase`, and
`external_message` cannot execute without an owner decision in the Approvals queue.
`branch_code_change` and `test_execution` are sandbox/restricted-branch scoped.

## SQL console

`POST /api/database/query` is owner-only and accepts read-only statements only. The classifier
strips comments, masks string literals, and blocks:

- stacked statements, writable CTEs, and `SELECT ... INTO`
- `EXPLAIN ANALYZE` (which executes the statement)
- DDL/DCL and server-control verbs (`DROP`, `TRUNCATE`, `GRANT`, `SET`, `CALL`, `DO`, `COPY`,
  `LOCK`, `PREPARE`, `REINDEX`, `DISCARD`, …)
- filesystem/replication functions (`pg_read_file`, `lo_import`, `dblink`, `pg_sleep`,
  `pg_terminate_backend`, `set_config`, …)

This is defence in depth, not a substitute for a real parser: the database user behind
`DATABASE_URL` should itself be read-only for anything reachable from this console.

## Data at rest and backups

- Local state lives in `.data/palash-state.json` (atomic write via temp file + rename). If the
  file is corrupt it is preserved as `.data/palash-state.corrupt-<timestamp>.json` instead of
  being silently replaced.
- `POST /api/system/backup` writes a verified snapshot to `.data/backups/` (retained: 20 files)
  with a full SHA-256 that is re-read from disk before success is reported.
- `POST /api/system/backups/:id/restore` requires `{"confirm": true}` and rejects path traversal.

## Database TLS

Set `PGSSLMODE=verify-full` in production so the Neon certificate is verified. The default
(encrypted, unverified) exists only for local development against self-signed endpoints.

## Reporting

Rotate owner credentials, `JWT_SECRET`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, and `DATABASE_URL`
immediately if any of them is exposed, then redeploy.
