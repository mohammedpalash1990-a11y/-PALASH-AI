# Neon Function deployment (`deploy/`)

The repository root is the full PALASH AI application (Express + React). The `deploy/`
directory holds a separate, dependency-light Neon Function build that serves a small HTML
dashboard against the same Postgres database.

## Files

- `deploy/palashai-function.zip.b64` — first unbundled source archive.
- `deploy/palashai-function-v2.zip.b64` — corrected unbundled source archive (`index.mjs` + `package.json`).
- `deploy/palashai-function-bundled.zip.b64` — deployable, esbuild-bundled archive produced by CI.
- `.github/workflows/build-neon-function.yml` — decodes `-v2`, installs its dependencies, bundles
  `index.mjs` with esbuild and commits the bundled `.b64` back to the branch.

## Runtime status

The live `/api/health` endpoint of the deployed function returned HTTP 500 with
`Required environment is missing`. The Neon side supplies the database binding, but this
function additionally requires:

- `ADMIN_EMAIL` — owner login email.
- `ADMIN_PASSWORD` — strong initial owner password.
- `JWT_SECRET` — long random signing secret.

Set these in Neon Console → Functions → `palashai` → Environment, then redeploy the latest
bundled ZIP. Never put these values in GitHub or chat.

## Important: two schemas, one database

The Neon Function (`deploy/palashai-function-v2.zip.b64` → `index.mjs`) and the Express app
(`server/pgBridge.ts`) do **not** share a schema:

| | Neon Function | Express app |
| --- | --- | --- |
| Identity | `BIGSERIAL` integer ids | `TEXT` ids (`usr-owner-1`, `task-<uuid>`) |
| Audit table | `activity_logs` | `audit_logs` |
| Settings | `agent_settings` | in-file JSON store |
| Token | 2-segment HMAC, 24h | 3-segment JWT-shaped, 12h |
| Front end | inline HTML, token in `localStorage` | React SPA, token in memory |

Point them at different databases (or different schemas) until they are unified. Running both
against one database will produce confusing half-empty dashboards rather than an error.

## Verifying a deployment

1. `curl https://<function-url>/api/health` → `{"ok":true,...}`.
2. Sign in through the function's HTML page with the configured owner credentials.
3. Confirm `/api/overview` returns the seeded 7 agents.
