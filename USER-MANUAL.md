# PALASH AI — User Manual

Production URL: https://palash-ai.pages.dev

PALASH AI is an owner-operated AI command center for project coordination, agent chat and tasks, GitHub workflows, approvals and safety, finance tracking, database inspection, monitoring, and selected social publishing integrations.

## 1. First sign-in

1. Open https://palash-ai.pages.dev.
2. On first launch, create the Owner account using your email, name, and a password of at least 8 characters.
3. Keep the password private. The current interface uses an Owner role.
4. On later visits, sign in with the same email and password.
5. Log out when finished on a shared device.

The session token is kept in the current browser tab's session storage so a page refresh can restore your Owner login. It is not stored in persistent local storage. Signing out, session expiry, or ending the browser tab session requires signing in again. Avoid using a shared or public device.

## 2. Main navigation

| Section | What it does |
| --- | --- |
| Home | Workspace status, project/task counts, approvals, finance summary, quick actions, and mission planning. |
| AI Assistant & Tasks | Chat with the Chief Agent or a specialist, create tasks, monitor progress, retry eligible failed tasks, and connect supported social accounts. |
| Approvals & Safety | Review or reject approval requests and activate/resume Emergency Stop. |
| Projects | Register projects, search and filter workspaces, and track project status/progress. |
| Finance | Manually record revenue, expenses, staff costs, and inventory spend; review calculated summaries. |
| GitHub | Connect a GitHub token, inspect repositories, browse files, request code analysis, review diffs, and stage controlled branch changes. Advanced sync and branch proposals are in expandable sections. |
| Database | Inspect database tables and create snapshots. Read-only SQL and migration proposals are in expandable advanced sections. |
| System Activity | Review health, backup history, service metrics, readiness checks, and audit events. Detailed readiness and audit views are expandable. |

## 3. Chat and natural-language commands

1. Open AI Assistant & Tasks.
2. Use a suggested prompt or type your own request. Select the agent and project context if you need a specific specialist or workspace.
3. Enter a question or instruction in the chat box and send it.
4. The Chief Agent can classify supported instructions into chat, task creation, integration status, social publishing draft, or Emergency Stop/resume.
5. When a task is created, review its scope and action type in the task queue. Execute it only when the interface offers the execution action.
6. Check the task result and audit trail. A chat response is not proof that a task or external action completed; rely on the task, approval, or provider status.

Example prompts:
- Summarize the current status of my projects.
- Create a research task to compare free hosting options for this project.
- Inspect the connected GitHub repository and identify the highest-risk bugs.
- Show my connected integrations.
- Draft a Facebook Page post about the latest product update.
- Activate Emergency Stop.
- Resume operations.

For precise results, name the project, repository, branch, target account, and expected output. Never put passwords, API keys, access tokens, or database connection strings in chat.

## 4. Tasks and agent execution

- Use Create Task for a defined unit of work. Include a specific title, scope, project, assigned agent, and action type.
- Read the task description and risk classification before execution.
- Running tasks show progress when the backend reports it.
- Retry is available only for eligible failed tasks.
- If Emergency Stop is active, autonomous execution is blocked until the Owner resumes operations.
- The current deployment does not provide a general-purpose unrestricted computer operator. A task can only perform actions implemented by the connected backend/provider.

## 5. Approvals and safety

The approval queue is the control point for sensitive operations. High-impact actions such as production deployment, database migration/restore/deletion, purchases/payments, external messages, social publishing, and GitHub branch changes are approval-gated by policy.

For every approval:
1. Read the title, project, action type, risk level, summary, and exact preview/payload.
2. Approve only if the preview is correct and the target is intended.
3. Reject anything unexpected or unclear.
4. Add a decision note where useful.

Emergency Stop halts agent execution. Activate it immediately if a task behaves unexpectedly. Resume only after checking the queue and system state. An approval is permission for the specific displayed action, not blanket permission for later actions.

## 6. GitHub connection and workflow

1. Open GitHub.
2. Create a GitHub Personal Access Token with only the repository permissions required for the intended work.
3. Paste the token into the dedicated GitHub connection field, not chat or a task description.
4. Confirm the connected GitHub identity and repository access.
5. Inspect the repository and branch before requesting changes.
6. Review proposed diffs carefully.
7. GitHub write operations are restricted to isolated feature branches and a pull request flow; direct pushes to the base branch are blocked by the backend branch policy.
8. Review and merge the pull request yourself after CI and code review pass.

GitHub OAuth is not configured in this release; use the token connection flow. Do not use a token with broader permissions than necessary.

## 7. Social media and messaging integrations

Open AI Assistant & Tasks → Connections & Memory → Connect a social account. Select a provider, enter its provider-issued access token and required account ID, then connect. PALASH AI verifies the account and stores the integration credential encrypted at rest. Disconnect an account when it is no longer needed.

| Provider | Current capability |
| --- | --- |
| Facebook Page | Verify/connect a Page; publish text posts after Owner approval. |
| Instagram Business | Verify/connect a Business account; publish an image plus caption after Owner approval. The image must be reachable through a public HTTPS URL. |
| LinkedIn | Verify/connect a member; publish public text posts after Owner approval. |
| YouTube | Verify the channel connection. Video upload/publishing is not enabled. |
| WhatsApp Business | Verify the phone-number connection. Message dispatch is not enabled. |

To publish, ask PALASH AI to draft a post and specify the provider, exact text, and (for Instagram) public image URL. Review the generated approval request and approve the exact preview only when ready. A draft is not a published post.

Provider app review, business eligibility, scopes, rate limits, and token expiry are controlled by the relevant platform.

## 8. Database Console

- Use the table browser to inspect the PALASH AI database.
- SQL is restricted to a single read-only SELECT or WITH query. Write statements are blocked.
- A schema change must be submitted as a migration proposal and pass Owner approval. Approval does not guarantee an executor is configured; check the task result before assuming it ran.
- Workspace restore requests require a verified snapshot and a separate Owner approval.
- Never use this console to experiment on another project's database. PALASH AI's workspace database is separate from the databases used by other projects.

## 9. Finance

The Finance ledger is manually maintained. Add revenue, expense, staff cost, or inventory entries with the correct project, category, date, currency, and amount. The dashboard calculates totals and margins from those entries.

The ledger is not automatically synchronized with bank accounts, POS systems, payment providers, invoices, or tax systems. Verify source records before relying on the figures.

## 10. Backups and restore

- Create Snapshot stores a checksum-verified workspace snapshot inside the PALASH AI Neon database.
- The scheduled GitHub Actions workflow runs daily at 02:17 UTC and creates a second snapshot.
- When the GitHub repository is private and the required NEON_API_KEY repository secret is configured, the workflow also stores an independent GitHub Actions artifact with 30-day retention.
- If the repository is public, the private artifact step is skipped. In-database snapshots are not offsite backups.
- Restore is a high-risk operation: verify the snapshot first, request restore, inspect the approval, and approve only if you intend to replace the current PALASH AI workspace state.

Google Drive and Cloudflare R2 replication are not configured.

## 11. Monitoring and readiness

Open System Activity to inspect service health, database connectivity, AI configuration, agent status, audit history, and production readiness blockers. A green UI/build status does not prove every external provider is connected or every end-to-end workflow is working.

Use the readiness report to identify missing setup. Resolve one blocker at a time and recheck the report.

## 12. Install as an app

On a supported browser, use Install App or the browser's Install app / Add to Home Screen option. The site is a Progressive Web App; it is not a native iOS or Android application. Some browser features, including speech recognition, depend on browser support and microphone permission.

## 13. AI provider configuration

Gemini is the primary AI provider in the deployed Neon function. The optional OpenAI API fallback requires an OPENAI_API_KEY secret in the Neon Function environment and an optional OPENAI_MODEL setting. The current deployed function environment reports OPENAI_MODEL but does not report OPENAI_API_KEY; therefore do not assume OpenAI fallback is active. OpenAI API usage is separate from a ChatGPT subscription and does not grant PALASH AI control over this ChatGPT session.

Never expose provider keys in the frontend, GitHub commits, screenshots, chat messages, or this manual.

## 14. Current release boundaries

The current release is an owner-operated command center, not an unrestricted autonomous employee. It can chat, plan supported tasks, track projects, inspect GitHub, stage controlled feature-branch changes, manage approval gates, record finance entries, inspect its own database, create snapshots, and use the listed social integrations.

The following are not enabled as autonomous capabilities in this release:
- Direct control of this ChatGPT conversation or its browser session.
- YouTube video upload/publishing.
- WhatsApp message dispatch.
- Automatic bank/POS/payment-provider synchronization.
- Google Drive/R2 backup replication.
- Unrestricted production deployment, database migration/deletion, or payment execution.
- A generic remote desktop/computer-use agent for arbitrary websites and applications.

Always verify completion in the relevant task, approval, GitHub, provider, or deployment record. Never rely on a conversational claim alone.
