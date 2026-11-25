# PALASH AI — Deployment & Operations Guide

## 1. Architecture Overview
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + `vite-plugin-pwa` (Desktop Command Center + Mobile PWA).
- **Backend**: Express (`server.ts`) running on port `3000`, serving Vite middleware in development and `dist/` in production.
- **AI Engine**: Server-side `@google/genai` SDK (`gemini-4-hydrogen`) for Chief Agent planning, specialist execution, interactive chat, and source code review.
- **Persistence**: Atomic 7-table local relational store (`.data/palash-state.json`) with seamless Neon PostgreSQL 17 integration via `DATABASE_URL`.

## 2. Environment Variables (Settings > Secrets)
Configure these server-side environment variables before production deployment:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Server-side Gemini API key for Chief Agent & 6 Specialists |
| `ADMIN_EMAIL` | Recommended | Primary Owner account email |
| `ADMIN_PASSWORD` | Recommended | Primary Owner account password (overrides first-run claim) |
| `JWT_SECRET` | Recommended | 32+ character HMAC signing key for Bearer sessions |
| `DATABASE_URL` | Optional | Neon PostgreSQL 17 connection string (`?sslmode=require`) |
| `GITHUB_TOKEN` | Optional | GitHub PAT for private repository inspection & branch workflows |

## 3. Verification & Build Commands
```bash
# Run core security, SQL guard, finance, and orchestrator unit tests
npm test

# Type-check TypeScript
npm run lint

# Build production SPA bundle
npm run build

# Start production server on port 3000
NODE_ENV=production npm start
```

## 4. Free-Tier & Safety Governance
- High-risk operations (`production_deploy`, `database_migration`, `database_deletion`, `payment_purchase`, `external_message`) always require Owner approval in **Approvals & Safety**.
- Existing connected project databases (**Musafir Cafe POS**, **Saudi Fast Food POS**, **Deenverse**, **Bangladesh Marketplace**) remain strictly isolated and are never modified or dropped by PALASH AI.
- Use **Emergency Stop** in the top header at any time to immediately halt active agent workers.
