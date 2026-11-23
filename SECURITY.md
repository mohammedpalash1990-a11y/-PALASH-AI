# Security

- Keep this repository private.
- Never commit `.env`, passwords, API keys, database URLs, JWT secrets, or customer data.
- Owner sessions use signed bearer tokens with a 24-hour expiry.
- Production deployments, destructive database operations, payments, and external communications remain approval-gated.
- Rotate owner credentials immediately if exposed.
