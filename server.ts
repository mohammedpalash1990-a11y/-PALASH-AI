import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  analyzeSourceCodeWithAgent,
  generateChiefAgentPlan,
  runInteractiveAgentChat,
  runSpecialistAgentExecution,
} from './server/aiEngine.ts';
import { computeFinancialSummary } from './server/core/finance.ts';
import { canRetryTask, transitionTaskForExecution } from './server/core/orchestrator.ts';
import {
  APPROVAL_POLICY_MATRIX,
  constantTimeEquals,
  createAuthToken,
  evaluateActionPolicy,
  hashPassword,
  inspectPromptSafety,
  SlidingWindowRateLimiter,
  verifyAuthToken,
  verifyPassword,
  type AuthTokenPayload,
} from './server/core/security.ts';
import { inspectSqlStatement } from './server/core/sqlGuard.ts';
import type { ActionType, AgentId, ApprovalRecord, TaskRecord } from './server/core/types.ts';
import { fetchRepositoryFile, inspectGitHubRepository, listRepositoryFiles } from './server/githubService.ts';
import {
  bootstrapPostgresSchema,
  checkPostgresHealth,
  listPostgresTables,
  queryPostgresReadOnly,
} from './server/pgBridge.ts';
import { DATA_DIR, palashStore } from './server/store.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * A per-process random secret silently invalidates every session on restart and
 * makes multi-instance deployments issue mutually invalid tokens. In production
 * we refuse to boot without JWT_SECRET; in development we persist a generated
 * secret under .data/ (mode 0600) so restarts keep sessions alive.
 */
function resolveSigningSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) {
      console.warn('[security] JWT_SECRET is shorter than 32 characters; use a longer random value.');
    }
    return configured;
  }
  if (IS_PRODUCTION) {
    throw new Error(
      'JWT_SECRET is required in production. Set a random 32+ character value in the environment.'
    );
  }
  const dir = DATA_DIR;
  const file = path.join(dir, '.jwt-secret');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600 });
    console.warn('[security] JWT_SECRET not set; generated a development secret at .data/.jwt-secret');
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const TOKEN_SIGNING_SECRET = resolveSigningSecret();
const rateLimiter = new SlidingWindowRateLimiter(180, 60_000);
// Credential endpoints get a much tighter budget than the rest of the API.
const authRateLimiter = new SlidingWindowRateLimiter(10, 5 * 60_000);

/** Collision-free identifier for records (Date.now() collided under load). */
function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

interface AuthenticatedRequest extends Request {
  authUser?: AuthTokenPayload;
}

/**
 * Express resolves req.ip against the configured `trust proxy` hop count, so
 * client-supplied X-Forwarded-For entries on the left cannot spoof the limit
 * key. Reading the raw header (as before) let anyone rotate the rate-limit key.
 */
function getClientIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

/**
 * Credential endpoints are throttled per-IP *and* per-account, so neither IP
 * rotation nor spraying a single account defeats the limit.
 */
function enforceAuthThrottle(req: AuthenticatedRequest, res: Response, email: string): boolean {
  const keys = [`ip:${getClientIp(req)}`, `account:${email || 'anonymous'}`];
  for (const key of keys) {
    const result = authRateLimiter.check(key);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.resetInMs / 1000))));
      res.status(429).json({
        error: 'Too many authentication attempts. Please wait before trying again.',
        retryAfterMs: result.resetInMs,
      });
      return false;
    }
  }
  return true;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Provide a valid Bearer token.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyAuthToken(token, TOKEN_SIGNING_SECRET);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token. Please sign in again.' });
    return;
  }
  req.authUser = payload;
  next();
}

function requireOwner(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.role !== 'owner') {
    res.status(403).json({ error: 'Owner authorization required for this action.' });
    return;
  }
  next();
}

function hasEnvAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_EMAIL?.trim() && process.env.ADMIN_PASSWORD?.trim());
}

export async function createApp(): Promise<express.Express> {
  const app = express();
  // Exactly one proxy hop (the platform edge); any more would let clients spoof X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Baseline hardening headers. No third-party dependency required.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (IS_PRODUCTION) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // API rate limiting & request latency tracking
  app.use('/api', (req, res, next) => {
    const start = Date.now();
    const ip = getClientIp(req);
    const limitResult = rateLimiter.check(ip);
    res.setHeader('X-RateLimit-Remaining', String(limitResult.remaining));
    if (!limitResult.allowed) {
      res.status(429).json({
        error: 'Rate limit exceeded. Try again shortly.',
        retryAfterMs: limitResult.resetInMs,
      });
      return;
    }

    res.on('finish', () => {
      const elapsed = Date.now() - start;
      // Metrics are in-memory only: writing the whole state file on every
      // request was a synchronous disk write on the hot path.
      palashStore.mutate(
        (db) => {
          const m = db.system.apiMetrics;
          const nextTotal = m.totalRequests + 1;
          m.avgLatencyMs = Math.round((m.avgLatencyMs * m.totalRequests + elapsed) / nextTotal);
          m.totalRequests = nextTotal;
          if (res.statusCode >= 500) {
            m.errorCount += 1;
          }
        },
        { persist: false }
      );
    });

    next();
  });

  // Phase 1: Health & Initialization Check
  app.get('/api/health', async (_req, res) => {
    const pgStatus = await checkPostgresHealth();
    const db = palashStore.getSnapshot();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY?.trim() !== 'MY_GEMINI_API_KEY'
    );
    const githubTokenConfigured = Boolean(process.env.GITHUB_TOKEN?.trim());

    palashStore.mutate(
      (snap) => {
        snap.system.apiMetrics.lastHealthCheckAt = new Date().toISOString();
      },
      { persist: false }
    );

    res.json({
      status: db.system.emergencyStop ? 'halted' : 'healthy',
      service: 'PALASH AI',
      timestamp: new Date().toISOString(),
      database: {
        localStoreInitialized: true,
        tablesCount: palashStore.listCanonicalTables().length,
        postgres: pgStatus,
      },
      agentsCount: db.agents.length,
      ownerAccountReady: db.users.length > 0 || hasEnvAdminConfigured(),
      geminiConfigured,
      githubTokenConfigured,
      emergencyStop: db.system.emergencyStop,
    });
  });

  // Phase 1: Auth Status / Setup / Login
  app.get('/api/auth/status', (_req, res) => {
    const db = palashStore.getSnapshot();
    const envConfigured = hasEnvAdminConfigured();
    const hasOwner = db.users.some((u) => u.role === 'owner');
    res.json({
      needsSetup: !envConfigured && !hasOwner,
      envAdminConfigured: envConfigured,
      // Only echo an address the operator configured themselves; the previous
      // hardcoded personal Gmail was published to every unauthenticated caller.
      suggestedEmail: process.env.ADMIN_EMAIL?.trim() || '',
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    const db = palashStore.getSnapshot();
    if (hasEnvAdminConfigured() || db.users.some((u) => u.role === 'owner')) {
      res.status(409).json({ error: 'Owner account is already configured. Please sign in.' });
      return;
    }

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'Palash Owner';

    if (!enforceAuthThrottle(req, res, email)) return;

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Please enter a valid owner email address.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const now = new Date().toISOString();
    const user = {
      id: 'usr-owner-1',
      email,
      name,
      role: 'owner' as const,
      passwordHash: hashPassword(password),
      createdAt: now,
      lastLoginAt: now,
    };

    palashStore.mutate((snap) => {
      snap.users.push(user);
    });
    palashStore.appendAudit({
      actor: email,
      action: 'OWNER_ACCOUNT_CLAIMED',
      resource: 'users/usr-owner-1',
      outcome: 'success',
      ip: getClientIp(req),
      details: 'First-run Owner account initialized via scrypt password claim.',
    });

    const token = createAuthToken({ sub: user.id, email: user.email, role: user.role }, TOKEN_SIGNING_SECRET);
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    if (!enforceAuthThrottle(req, res, email)) return;

    const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const envPassword = process.env.ADMIN_PASSWORD?.trim();
    const db = palashStore.getSnapshot();

    // Env admin takes precedence when configured
    if (envEmail && envPassword && constantTimeEquals(email, envEmail)) {
      if (!constantTimeEquals(password, envPassword)) {
        palashStore.appendAudit({
          actor: email,
          action: 'LOGIN_FAILED',
          resource: 'auth',
          outcome: 'blocked',
          ip: getClientIp(req),
          details: 'Invalid Owner password attempt.',
        });
        res.status(401).json({ error: 'Invalid credentials.' });
        return;
      }
      const now = new Date().toISOString();
      let owner = db.users.find((u) => u.email === envEmail);
      if (!owner) {
        owner = {
          id: 'usr-owner-1',
          email: envEmail,
          name: 'Palash Owner',
          role: 'owner',
          passwordHash: hashPassword(envPassword),
          createdAt: now,
          lastLoginAt: now,
        };
        palashStore.mutate((snap) => {
          snap.users.push(owner!);
        });
      } else {
        palashStore.mutate((snap) => {
          const target = snap.users.find((u) => u.id === owner!.id);
          if (target) target.lastLoginAt = now;
        });
      }

      const token = createAuthToken({ sub: owner.id, email: owner.email, role: owner.role }, TOKEN_SIGNING_SECRET);
      palashStore.appendAudit({
        actor: owner.email,
        action: 'OWNER_LOGIN',
        resource: 'auth',
        outcome: 'success',
        ip: getClientIp(req),
        details: 'Authenticated via environment Owner policy.',
      });
      res.json({
        token,
        user: { id: owner.id, email: owner.email, name: owner.name, role: owner.role },
      });
      return;
    }

    const user = db.users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      palashStore.appendAudit({
        actor: email,
        action: 'LOGIN_FAILED',
        resource: 'auth',
        outcome: 'blocked',
        ip: getClientIp(req),
        details: 'Invalid email or password.',
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    palashStore.mutate((snap) => {
      const target = snap.users.find((u) => u.id === user.id);
      if (target) target.lastLoginAt = new Date().toISOString();
    });

    const token = createAuthToken({ sub: user.id, email: user.email, role: user.role }, TOKEN_SIGNING_SECRET);
    palashStore.appendAudit({
      actor: user.email,
      action: 'OWNER_LOGIN',
      resource: 'auth',
      outcome: 'success',
      ip: getClientIp(req),
      details: 'Owner signed in cleanly.',
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'OWNER_LOGOUT',
      resource: 'auth',
      outcome: 'success',
      ip: getClientIp(req),
      details: 'Owner signed out.',
    });
    res.json({ ok: true });
  });

  // Phase 1: /api/me, /api/overview, /api/agents, /api/policies
  app.get('/api/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = palashStore.getSnapshot();
    const user = db.users.find((u) => u.id === req.authUser?.sub);
    res.json({
      id: req.authUser?.sub,
      email: req.authUser?.email,
      name: user?.name || 'Palash Owner',
      role: req.authUser?.role || 'owner',
      lastLoginAt: user?.lastLoginAt || null,
    });
  });

  app.get('/api/overview', requireAuth, (_req, res) => {
    const db = palashStore.getSnapshot();
    const finance = computeFinancialSummary(db.ledger_entries, db.budget_targets);
    res.json({
      projectsCount: db.projects.length,
      agentsCount: db.agents.length,
      tasks: {
        total: db.tasks.length,
        queued: db.tasks.filter((t) => t.status === 'queued').length,
        running: db.tasks.filter((t) => t.status === 'running').length,
        awaitingApproval: db.tasks.filter((t) => t.status === 'awaiting_approval').length,
        completed: db.tasks.filter((t) => t.status === 'completed').length,
        failed: db.tasks.filter((t) => t.status === 'failed').length,
      },
      pendingApprovalsCount: db.approvals.filter((a) => a.status === 'pending').length,
      emergencyStop: db.system.emergencyStop,
      emergencyStopReason: db.system.emergencyStopReason,
      financeSummary: finance,
      recentTasks: db.tasks.slice(0, 8),
      recentApprovals: db.approvals.slice(0, 5),
      recentAudit: db.audit_logs.slice(0, 8),
      projects: db.projects,
    });
  });

  app.get('/api/agents', requireAuth, (_req, res) => {
    const db = palashStore.getSnapshot();
    res.json({
      agents: db.agents,
      policies: Object.values(APPROVAL_POLICY_MATRIX),
    });
  });

  app.get('/api/policies', requireAuth, (_req, res) => {
    res.json({ policies: Object.values(APPROVAL_POLICY_MATRIX) });
  });

  // Phase 2: Chief Agent Mission Planner & Task Execution Engine
  app.post('/api/missions/plan', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const objective = typeof req.body?.objective === 'string' ? req.body.objective.trim() : '';
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'palash-ai';
    if (!objective) {
      res.status(400).json({ error: 'Mission objective is required.' });
      return;
    }

    const db = palashStore.getSnapshot();
    if (db.system.emergencyStop) {
      res.status(423).json({ error: 'Emergency Stop is active. Resume operations before planning new missions.' });
      return;
    }

    const safety = inspectPromptSafety(objective);
    if (!safety.safe) {
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'PROMPT_INJECTION_BLOCKED',
        resource: `missions/${projectId}`,
        outcome: 'blocked',
        ip: getClientIp(req),
        details: `Blocked suspicious patterns: ${safety.flaggedPatterns.join(', ')}`,
      });
      res.status(400).json({
        error: `Prompt safety guard flagged restricted patterns (${safety.flaggedPatterns.join(', ')}). Rephrase without policy bypass instructions.`,
      });
      return;
    }

    const project = db.projects.find((p) => p.id === projectId) || db.projects[0];
    try {
      const plan = await generateChiefAgentPlan(objective, project, db.agents, db.agent_memory);
      const now = new Date().toISOString();
      const missionId = newId('mission');
      const createdTasks: TaskRecord[] = [];
      const createdApprovals: ApprovalRecord[] = [];

      for (let i = 0; i < plan.tasks.length; i++) {
        const sub = plan.tasks[i];
        const policy = evaluateActionPolicy(sub.actionType, false);
        const taskId = `${newId('task')}-${i}`;
        const task: TaskRecord = {
          id: taskId,
          missionId,
          projectId: project.id,
          assignedAgentId: sub.assignedAgentId,
          title: sub.title,
          description: sub.description,
          actionType: sub.actionType,
          riskLevel: policy.rule.riskLevel,
          approvalRequirement: policy.rule.requirement,
          status: policy.requiresApproval ? 'awaiting_approval' : 'queued',
          progressPercent: 0,
          currentStage: policy.requiresApproval ? 'Awaiting Owner sign-off' : 'Queued for execution',
          attempts: 0,
          maxAttempts: 3,
          outputReport: null,
          errorMessage: null,
          durationMs: null,
          createdAt: now,
          updatedAt: now,
        };
        createdTasks.push(task);

        if (policy.requiresApproval) {
          createdApprovals.push({
            id: `${newId('apr')}-${i}`,
            taskId,
            projectId: project.id,
            requestedByAgentId: sub.assignedAgentId,
            actionType: sub.actionType,
            riskLevel: policy.rule.riskLevel === 'low' ? 'medium' : policy.rule.riskLevel,
            title: `${policy.rule.label}: ${sub.title}`,
            summary: sub.description,
            payloadPreview: `Project: ${project.name} · Agent: ${sub.assignedAgentId} · Action: ${sub.actionType}`,
            status: 'pending',
            decidedBy: null,
            decisionNote: null,
            createdAt: now,
            decidedAt: null,
          });
        }
      }

      palashStore.mutate((snap) => {
        snap.tasks.unshift(...createdTasks);
        if (createdApprovals.length > 0) {
          snap.approvals.unshift(...createdApprovals);
        }
        const chief = snap.agents.find((a) => a.id === 'chief-agent');
        if (chief) {
          chief.completedTasks += 1;
          chief.lastActiveAt = now;
        }
        snap.agent_memory.unshift({
          id: newId('mem'),
          projectId: project.id,
          agentId: 'chief-agent',
          category: 'decision',
          title: `Mission Plan: ${objective.slice(0, 60)}`,
          content: plan.executiveSummary,
          createdAt: now,
        });
      });

      palashStore.appendAudit({
        actor: 'chief-agent',
        action: 'MISSION_PLANNED',
        resource: project.id,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Created ${createdTasks.length} tasks (${createdApprovals.length} gated for approval).`,
      });

      res.status(201).json({
        missionId,
        executiveSummary: plan.executiveSummary,
        tasks: createdTasks,
        approvals: createdApprovals,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chief Agent planning failed.';
      palashStore.appendAudit({
        actor: 'chief-agent',
        action: 'MISSION_PLAN_ERROR',
        resource: project.id,
        outcome: 'error',
        ip: getClientIp(req),
        details: msg,
      });
      res.status(502).json({ error: msg });
    }
  });

  app.get('/api/tasks', requireAuth, (_req, res) => {
    const db = palashStore.getSnapshot();
    const tasks = db.tasks.map((t) => ({
      ...t,
      progressPercent: t.progressPercent ?? (t.status === 'completed' ? 100 : 0),
      currentStage: t.currentStage ?? (t.status === 'completed' ? 'Completed' : t.status === 'running' ? 'Executing' : 'Queued'),
    }));
    res.json({ tasks });
  });

  app.get('/api/tasks/live-progress', requireAuth, (_req, res) => {
    const db = palashStore.getSnapshot();
    const activeTasks = db.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      assignedAgentId: t.assignedAgentId,
      projectId: t.projectId,
      status: t.status,
      progressPercent: t.progressPercent ?? (t.status === 'completed' ? 100 : 0),
      currentStage: t.currentStage ?? (t.status === 'completed' ? 'Completed' : t.status === 'running' ? 'Executing' : 'Queued'),
      updatedAt: t.updatedAt,
    }));
    res.json({
      tasks: activeTasks,
      hasRunning: activeTasks.some((t) => t.status === 'running'),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/tasks/:id/progress', requireAuth, (req, res) => {
    const db = palashStore.getSnapshot();
    const task = db.tasks.find((t) => t.id === req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({
      id: task.id,
      status: task.status,
      progressPercent: task.progressPercent ?? (task.status === 'completed' ? 100 : 0),
      currentStage: task.currentStage ?? (task.status === 'completed' ? 'Completed' : task.status === 'running' ? 'Executing' : 'Queued'),
      updatedAt: task.updatedAt,
    });
  });

  app.post('/api/tasks', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'palash-ai';
    const assignedAgentIdInput = req.body?.assignedAgentId;
    const actionTypeInput = req.body?.actionType;

    if (!title) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }

    const db = palashStore.getSnapshot();
    const knownAgentIds = new Set<string>(db.agents.map((a) => a.id));
    if (assignedAgentIdInput !== undefined && typeof assignedAgentIdInput !== 'string') {
      res.status(400).json({ error: 'assignedAgentId must be a string.' });
      return;
    }
    if (typeof assignedAgentIdInput === 'string' && !knownAgentIds.has(assignedAgentIdInput)) {
      res.status(400).json({
        error: `Unknown agent "${assignedAgentIdInput}". Known agents: ${[...knownAgentIds].join(', ')}`,
      });
      return;
    }
    if (actionTypeInput !== undefined && typeof actionTypeInput !== 'string') {
      res.status(400).json({ error: 'actionType must be a string.' });
      return;
    }
    if (
      typeof actionTypeInput === 'string' &&
      !Object.prototype.hasOwnProperty.call(APPROVAL_POLICY_MATRIX, actionTypeInput)
    ) {
      res.status(400).json({
        error: `Unknown actionType "${actionTypeInput}". Known actions: ${Object.keys(APPROVAL_POLICY_MATRIX).join(', ')}`,
      });
      return;
    }
    const assignedAgentId: AgentId = (assignedAgentIdInput as AgentId) || 'software-engineer';
    const actionType: ActionType = (actionTypeInput as ActionType) || 'research';
    const policy = evaluateActionPolicy(actionType, db.system.emergencyStop);
    if (policy.blockedByEmergencyStop) {
      res.status(423).json({ error: 'Emergency Stop is active. Resume operations first.' });
      return;
    }

    const now = new Date().toISOString();
    const taskId = newId('task');
    const task: TaskRecord = {
      id: taskId,
      missionId: 'manual-queue',
      projectId,
      assignedAgentId,
      title,
      description: description || title,
      actionType,
      riskLevel: policy.rule.riskLevel,
      approvalRequirement: policy.rule.requirement,
      status: policy.requiresApproval ? 'awaiting_approval' : 'queued',
      progressPercent: 0,
      currentStage: policy.requiresApproval ? 'Awaiting Owner sign-off' : 'Queued in task backlog',
      attempts: 0,
      maxAttempts: 3,
      outputReport: null,
      errorMessage: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    };

    let approval: ApprovalRecord | null = null;
    if (policy.requiresApproval) {
      approval = {
        id: newId('apr'),
        taskId,
        projectId,
        requestedByAgentId: assignedAgentId,
        actionType,
        riskLevel: policy.rule.riskLevel === 'low' ? 'medium' : policy.rule.riskLevel,
        title: `${policy.rule.label}: ${title}`,
        summary: description || title,
        payloadPreview: `Manual Task · Project: ${projectId} · Action: ${actionType}`,
        status: 'pending',
        decidedBy: null,
        decisionNote: null,
        createdAt: now,
        decidedAt: null,
      };
    }

    palashStore.mutate((snap) => {
      snap.tasks.unshift(task);
      if (approval) snap.approvals.unshift(approval);
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'TASK_CREATED',
      resource: `${projectId}/${taskId}`,
      outcome: approval ? 'pending' : 'success',
      ip: getClientIp(req),
      details: `Assigned "${title}" to ${assignedAgentId} (${actionType}).`,
    });

    res.status(201).json({ task, approval });
  });

  app.post('/api/tasks/:id/execute', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const db = palashStore.getSnapshot();
    const task = db.tasks.find((t) => t.id === req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    if (db.system.emergencyStop) {
      res.status(423).json({ error: 'Emergency Stop is active. Task execution blocked.' });
      return;
    }

    // Check if task requires approval and hasn't been approved yet
    const linkedApproval = db.approvals.find((a) => a.taskId === task.id);
    const policy = evaluateActionPolicy(task.actionType, false);
    if (policy.requiresApproval && linkedApproval?.status !== 'approved') {
      if (!linkedApproval) {
        const trans = transitionTaskForExecution(task, false, new Date().toISOString());
        const approval: ApprovalRecord = {
          id: newId('apr'),
          taskId: task.id,
          projectId: task.projectId,
          requestedByAgentId: task.assignedAgentId,
          actionType: task.actionType,
          riskLevel: policy.rule.riskLevel === 'low' ? 'medium' : policy.rule.riskLevel,
          title: `${policy.rule.label}: ${task.title}`,
          summary: task.description,
          payloadPreview: `Task ${task.id} requires Owner approval before execution.`,
          status: 'pending',
          decidedBy: null,
          decisionNote: null,
          createdAt: new Date().toISOString(),
          decidedAt: null,
        };
        palashStore.mutate((snap) => {
          const idx = snap.tasks.findIndex((t) => t.id === task.id);
          if (idx !== -1) snap.tasks[idx] = trans.nextTask;
          snap.approvals.unshift(approval);
        });
      }
      res.status(409).json({ error: 'Task requires Owner approval in the Approvals queue before execution.' });
      return;
    }

    const agent = db.agents.find((a) => a.id === task.assignedAgentId) || db.agents[0];
    const project = db.projects.find((p) => p.id === task.projectId) || db.projects[0];
    const startMs = Date.now();
    const nowIso = new Date().toISOString();

    palashStore.mutate((snap) => {
      const t = snap.tasks.find((item) => item.id === task.id);
      if (t) {
        t.status = 'running';
        t.progressPercent = 15;
        t.currentStage = 'Loading agent memory & isolating project scope...';
        t.attempts += 1;
        t.errorMessage = null;
        t.updatedAt = nowIso;
      }
      const ag = snap.agents.find((item) => item.id === agent.id);
      if (ag) ag.status = 'executing';
    });

    const progressTimer1 = setTimeout(() => {
      palashStore.mutate((snap) => {
        const t = snap.tasks.find((item) => item.id === task.id);
        if (t && t.status === 'running') {
          t.progressPercent = 45;
          t.currentStage = 'Running specialist reasoning model...';
          t.updatedAt = new Date().toISOString();
        }
      });
    }, 350);

    const progressTimer2 = setTimeout(() => {
      palashStore.mutate((snap) => {
        const t = snap.tasks.find((item) => item.id === task.id);
        if (t && t.status === 'running') {
          t.progressPercent = 75;
          t.currentStage = 'Auditing findings against security & policy matrix...';
          t.updatedAt = new Date().toISOString();
        }
      });
    }, 1100);

    const progressTimer3 = setTimeout(() => {
      palashStore.mutate((snap) => {
        const t = snap.tasks.find((item) => item.id === task.id);
        if (t && t.status === 'running') {
          t.progressPercent = 90;
          t.currentStage = 'Finalizing structured execution report...';
          t.updatedAt = new Date().toISOString();
        }
      });
    }, 2200);

    try {
      const report = await runSpecialistAgentExecution(task, agent, project, db.agent_memory);
      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      clearTimeout(progressTimer3);
      const durationMs = Date.now() - startMs;
      const doneIso = new Date().toISOString();

      palashStore.mutate((snap) => {
        const t = snap.tasks.find((item) => item.id === task.id);
        if (t) {
          t.status = 'completed';
          t.progressPercent = 100;
          t.currentStage = 'Execution completed successfully';
          t.outputReport = report;
          t.durationMs = durationMs;
          t.updatedAt = doneIso;
        }
        const ag = snap.agents.find((item) => item.id === agent.id);
        if (ag) {
          ag.status = 'ready';
          ag.completedTasks += 1;
          ag.avgLatencyMs = Math.round((ag.avgLatencyMs + durationMs) / 2);
          ag.lastActiveAt = doneIso;
        }
        snap.agent_memory.unshift({
          id: newId('mem'),
          projectId: project.id,
          agentId: agent.id,
          category: 'report',
          title: `Execution Report: ${task.title}`,
          content: report.slice(0, 600),
          createdAt: doneIso,
        });
      });

      palashStore.appendAudit({
        actor: agent.id,
        action: 'TASK_EXECUTED',
        resource: `${project.id}/${task.id}`,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Completed "${task.title}" in ${durationMs}ms.`,
      });

      res.json({
        task: palashStore.getSnapshot().tasks.find((t) => t.id === task.id),
      });
    } catch (err) {
      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      clearTimeout(progressTimer3);
      const durationMs = Date.now() - startMs;
      const errMsg = err instanceof Error ? err.message : 'Agent execution error';
      const failIso = new Date().toISOString();

      palashStore.mutate((snap) => {
        const t = snap.tasks.find((item) => item.id === task.id);
        if (t) {
          t.status = 'failed';
          t.progressPercent = 0;
          t.currentStage = 'Execution failed';
          t.errorMessage = errMsg;
          t.durationMs = durationMs;
          t.updatedAt = failIso;
        }
        const ag = snap.agents.find((item) => item.id === agent.id);
        if (ag) {
          ag.status = 'ready';
          ag.failedTasks += 1;
          ag.lastActiveAt = failIso;
        }
      });

      palashStore.appendAudit({
        actor: agent.id,
        action: 'TASK_EXECUTION_FAILED',
        resource: `${project.id}/${task.id}`,
        outcome: 'error',
        ip: getClientIp(req),
        details: errMsg,
      });

      res.status(502).json({ error: errMsg });
    }
  });

  app.post('/api/tasks/:id/retry', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const db = palashStore.getSnapshot();
    const task = db.tasks.find((t) => t.id === req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    if (!canRetryTask(task)) {
      res.status(400).json({ error: 'Task is not eligible for retry (either not failed or max attempts reached).' });
      return;
    }

    palashStore.mutate((snap) => {
      const t = snap.tasks.find((item) => item.id === task.id);
      if (t) {
        t.status = 'queued';
        t.progressPercent = 0;
        t.currentStage = 'Re-queued for retry';
        t.errorMessage = null;
        t.updatedAt = new Date().toISOString();
      }
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'TASK_RETRY_QUEUED',
      resource: task.id,
      outcome: 'success',
      ip: getClientIp(req),
      details: `Re-queued failed task "${task.title}" (attempt ${task.attempts}/${task.maxAttempts}).`,
    });

    res.json({ task: palashStore.getSnapshot().tasks.find((t) => t.id === task.id) });
  });

  // Interactive Agent Chat
  app.post('/api/chat', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const agentId = (req.body?.agentId as AgentId) || 'chief-agent';
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'palash-ai';
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      res.status(400).json({ error: 'Chat message cannot be empty.' });
      return;
    }

    const safety = inspectPromptSafety(message);
    if (!safety.safe) {
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'CHAT_INJECTION_BLOCKED',
        resource: `chat/${agentId}`,
        outcome: 'blocked',
        ip: getClientIp(req),
        details: `Flagged prompt patterns: ${safety.flaggedPatterns.join(', ')}`,
      });
      res.status(400).json({
        error: `Prompt Injection Guard blocked restricted directives (${safety.flaggedPatterns.join(', ')}).`,
      });
      return;
    }

    const db = palashStore.getSnapshot();
    if (db.system.emergencyStop) {
      res.status(423).json({ error: 'Emergency Stop is active. Resume system operations to chat with agents.' });
      return;
    }

    const agent = db.agents.find((a) => a.id === agentId) || db.agents[0];
    const project = db.projects.find((p) => p.id === projectId) || db.projects[0];

    try {
      const reply = await runInteractiveAgentChat(message, agent, project, history, db.agent_memory);
      palashStore.mutate((snap) => {
        const ag = snap.agents.find((a) => a.id === agent.id);
        if (ag) ag.lastActiveAt = new Date().toISOString();
      });
      res.json({
        agentId: agent.id,
        agentName: agent.name,
        reply,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent chat failed.';
      res.status(502).json({ error: msg });
    }
  });

  // Phase 5: Approvals & Emergency Stop
  app.get('/api/approvals', requireAuth, (_req, res) => {
    res.json({ approvals: palashStore.getSnapshot().approvals });
  });

  app.post('/api/approvals/:id/decide', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const decision = req.body?.decision;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
      return;
    }

    const db = palashStore.getSnapshot();
    const approval = db.approvals.find((a) => a.id === req.params.id);
    if (!approval) {
      res.status(404).json({ error: 'Approval request not found.' });
      return;
    }
    if (approval.status !== 'pending') {
      res.status(409).json({ error: `Approval is already ${approval.status}.` });
      return;
    }

    const now = new Date().toISOString();
    palashStore.mutate((snap) => {
      const target = snap.approvals.find((a) => a.id === approval.id);
      if (target) {
        target.status = decision;
        target.decidedBy = req.authUser?.email || 'owner';
        target.decisionNote = note || null;
        target.decidedAt = now;
      }

      const task = snap.tasks.find((t) => t.id === approval.taskId);
      if (task) {
        if (decision === 'approved') {
          task.status = 'queued';
          task.updatedAt = now;
        } else {
          task.status = 'cancelled';
          task.errorMessage = note || 'Rejected by Owner in approval gate.';
          task.updatedAt = now;
        }
      }
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: decision === 'approved' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED',
      resource: `${approval.projectId}/${approval.id}`,
      outcome: decision === 'approved' ? 'success' : 'blocked',
      ip: getClientIp(req),
      details: `${decision.toUpperCase()} "${approval.title}"${note ? ` — ${note}` : ''}`,
    });

    res.json({
      approval: palashStore.getSnapshot().approvals.find((a) => a.id === approval.id),
      task: palashStore.getSnapshot().tasks.find((t) => t.id === approval.taskId),
    });
  });

  app.post('/api/system/emergency-stop', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const active = Boolean(req.body?.active);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : 'Manual Owner Override';
    const now = new Date().toISOString();

    palashStore.mutate((snap) => {
      snap.system.emergencyStop = active;
      snap.system.emergencyStopReason = active ? reason : null;
      snap.system.emergencyStoppedAt = active ? now : null;
      for (const ag of snap.agents) {
        ag.status = active ? 'halted' : 'ready';
      }
      if (active) {
        for (const t of snap.tasks) {
          if (t.status === 'running') {
            t.status = 'failed';
            t.errorMessage = 'Aborted immediately by Owner Emergency Stop.';
            t.updatedAt = now;
          }
        }
      }
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: active ? 'EMERGENCY_STOP_TRIGGERED' : 'EMERGENCY_STOP_CLEARED',
      resource: 'system/orchestrator',
      outcome: active ? 'blocked' : 'success',
      ip: getClientIp(req),
      details: active ? `All agents halted: ${reason}` : 'System resumed normal operations.',
    });

    res.json({
      emergencyStop: active,
      reason: active ? reason : null,
      agents: palashStore.getSnapshot().agents,
    });
  });

  // Phase 6: Projects Center
  app.get('/api/projects', requireAuth, (_req, res) => {
    res.json({ projects: palashStore.getSnapshot().projects });
  });

  app.post('/api/projects', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const repoOwner = typeof req.body?.repoOwner === 'string' ? req.body.repoOwner.trim() : '';
    const repoName = typeof req.body?.repoName === 'string' ? req.body.repoName.trim() : '';
    const PROJECT_CATEGORIES = ['platform', 'pos', 'marketplace', 'saas'] as const;
    const categoryInput = req.body?.category;
    if (
      categoryInput !== undefined &&
      (typeof categoryInput !== 'string' ||
        !(PROJECT_CATEGORIES as readonly string[]).includes(categoryInput))
    ) {
      res.status(400).json({
        error: `Invalid category. Allowed: ${PROJECT_CATEGORIES.join(', ')}`,
      });
      return;
    }
    const category = (categoryInput as (typeof PROJECT_CATEGORIES)[number]) || 'saas';
    const deadline = typeof req.body?.deadline === 'string' && req.body.deadline ? req.body.deadline : '2027-01-31';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

    if (!name || !repoOwner || !repoName) {
      res.status(400).json({ error: 'Project name, repository owner, and repository name are required.' });
      return;
    }

    const slugId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existingProjects = palashStore.getSnapshot().projects;
    if (slugId && existingProjects.some((p) => p.id === slugId)) {
      res.status(409).json({ error: `A project with id "${slugId}" already exists.` });
      return;
    }
    const id = slugId || newId('proj');
    const now = new Date().toISOString();
    const project = {
      id,
      name,
      slug: `${repoOwner}/${repoName}`,
      category,
      repoOwner,
      repoName,
      defaultBranch: 'main',
      permissionScope: 'branch-only-with-approval' as const,
      dbIsolationLabel: `${id.replace(/-/g, '_')}_isolated (Protected)`,
      deploymentPolicy: 'mandatory-owner-approval' as const,
      status: 'active' as const,
      progress: 10,
      deadline,
      description: description || `${name} managed under isolated PALASH AI agent scope.`,
      updatedAt: now,
    };

    palashStore.mutate((snap) => {
      snap.projects.push(project);
      snap.budget_targets.push({
        projectId: project.id,
        monthlyBudget: 2000,
        revenueTarget: 5000,
        staffCostCap: 1000,
      });
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'PROJECT_REGISTERED',
      resource: project.id,
      outcome: 'success',
      ip: getClientIp(req),
      details: `Registered isolated project "${project.name}" (${project.slug}).`,
    });

    res.status(201).json({ project });
  });

  app.patch('/api/projects/:id', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const db = palashStore.getSnapshot();
    const existing = db.projects.find((p) => p.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const nextProgress =
      typeof req.body?.progress === 'number'
        ? Math.max(0, Math.min(100, Math.round(req.body.progress)))
        : existing.progress;
    const nextStatus =
      req.body?.status === 'active' || req.body?.status === 'maintenance' || req.body?.status === 'attention'
        ? req.body.status
        : existing.status;

    palashStore.mutate((snap) => {
      const target = snap.projects.find((p) => p.id === existing.id);
      if (target) {
        target.progress = nextProgress;
        target.status = nextStatus;
        target.updatedAt = new Date().toISOString();
      }
    });

    res.json({ project: palashStore.getSnapshot().projects.find((p) => p.id === existing.id) });
  });

  // Phase 3: GitHub Engineering Inspection & PR Approval Gate
  app.post('/api/github/inspect', requireAuth, requireOwner, async (req, res) => {
    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    if (!owner || !repo) {
      res.status(400).json({ error: 'GitHub owner and repo name are required.' });
      return;
    }

    try {
      const inspection = await inspectGitHubRepository(owner, repo);
      res.json(inspection);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'GitHub inspection failed.' });
    }
  });

  app.post('/api/github/files', requireAuth, requireOwner, async (req, res) => {
    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const branch = typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'main';
    if (!owner || !repo) {
      res.status(400).json({ error: 'GitHub owner and repo name are required.' });
      return;
    }
    try {
      const files = await listRepositoryFiles(owner, repo, branch);
      res.json({ files });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to list files.' });
    }
  });

  app.post('/api/github/analyze', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : '';
    const branch = typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'main';

    if (!owner || !repo || !filePath) {
      res.status(400).json({ error: 'owner, repo, and filePath are required.' });
      return;
    }

    try {
      const file = await fetchRepositoryFile(owner, repo, filePath, branch);
      const analysis = await analyzeSourceCodeWithAgent(`${owner}/${repo}`, file.path, file.content);
      palashStore.appendAudit({
        actor: 'quality-auditor',
        action: 'SOURCE_CODE_ANALYZED',
        resource: `${owner}/${repo}/${file.path}`,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Reviewed ${file.path} (${file.size} bytes).`,
      });
      res.json({
        path: file.path,
        size: file.size,
        content: file.content,
        analysis,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Code analysis failed.' });
    }
  });

  app.post('/api/github/propose-pr', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'palash-ai';
    const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : 'feat/agent-patch';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';

    if (!title) {
      res.status(400).json({ error: 'Pull request title is required.' });
      return;
    }

    const now = new Date().toISOString();
    const taskId = newId('task-pr');
    const approvalId = newId('apr-pr');

    const task: TaskRecord = {
      id: taskId,
      missionId: 'github-engineering',
      projectId,
      assignedAgentId: 'software-engineer',
      title: `PR Proposal (${branch}): ${title}`,
      description: summary || `Prepare branch ${branch} and submit pull request for Owner merge approval.`,
      actionType: 'branch_code_change',
      riskLevel: 'medium',
      approvalRequirement: 'restricted_branch',
      status: 'awaiting_approval',
      progressPercent: 0,
      currentStage: 'Awaiting PR merge approval',
      attempts: 0,
      maxAttempts: 3,
      outputReport: null,
      errorMessage: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    };

    const approval: ApprovalRecord = {
      id: approvalId,
      taskId,
      projectId,
      requestedByAgentId: 'software-engineer',
      actionType: 'branch_code_change',
      riskLevel: 'medium',
      title: `Branch Change & PR Merge Gate: ${title}`,
      summary: summary || `Target branch: ${branch}`,
      payloadPreview: `git checkout -b ${branch} && gh pr create --title "${title}"`,
      status: 'pending',
      decidedBy: null,
      decisionNote: null,
      createdAt: now,
      decidedAt: null,
    };

    palashStore.mutate((snap) => {
      snap.tasks.unshift(task);
      snap.approvals.unshift(approval);
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'PR_APPROVAL_QUEUED',
      resource: `${projectId}/${branch}`,
      outcome: 'pending',
      ip: getClientIp(req),
      details: `Queued branch change approval for "${title}".`,
    });

    res.status(201).json({ task, approval });
  });

  // Phase 4: Database Console & Migration Gate
  app.get('/api/database/tables', requireAuth, async (_req, res) => {
    const pgHealth = await checkPostgresHealth();
    const pgTables = pgHealth.connected ? await listPostgresTables() : [];
    const localTables = palashStore.listCanonicalTables();
    res.json({
      mode: pgHealth.connected ? 'neon-postgres' : 'local-relational-store',
      postgres: pgHealth,
      tables: pgHealth.connected && pgTables.length > 0 ? pgTables : localTables,
      localTables,
    });
  });

  app.post('/api/database/bootstrap-pg', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await bootstrapPostgresSchema();
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'POSTGRES_SCHEMA_BOOTSTRAPPED',
        resource: result.database || 'neon_postgres',
        outcome: 'success',
        ip: getClientIp(req),
        details: `Verified/created ${result.createdTables.length} tables in PostgreSQL.`,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Schema bootstrap failed.' });
    }
  });

  app.post('/api/database/query', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const sql = typeof req.body?.sql === 'string' ? req.body.sql : '';
    const target = req.body?.target === 'postgres' ? 'postgres' : 'local';
    const inspection = inspectSqlStatement(sql);

    if (!inspection.allowedDirectExecution) {
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'SQL_GUARD_BLOCKED',
        resource: target,
        outcome: 'blocked',
        ip: getClientIp(req),
        details: `${inspection.classification}: ${inspection.reason}`,
      });
      res.status(403).json({
        error: inspection.reason,
        inspection,
      });
      return;
    }

    const start = Date.now();
    try {
      const result =
        target === 'postgres'
          ? await queryPostgresReadOnly(inspection.normalizedSql)
          : palashStore.executeSafeReadQuery(inspection.normalizedSql);
      res.json({
        ...result,
        executionMs: Date.now() - start,
        classification: inspection.classification,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Query execution failed.',
      });
    }
  });

  app.post('/api/database/migrate', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'palash-ai';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const sql = typeof req.body?.sql === 'string' ? req.body.sql.trim() : '';

    if (!title || !sql) {
      res.status(400).json({ error: 'Migration title and SQL statement are required.' });
      return;
    }

    const inspection = inspectSqlStatement(sql);
    const isDeletion = inspection.classification === 'destructive_blocked';
    const actionType: ActionType = isDeletion ? 'database_deletion' : 'database_migration';
    const now = new Date().toISOString();
    const taskId = newId('task-mig');
    const approvalId = newId('apr-mig');

    const task: TaskRecord = {
      id: taskId,
      missionId: 'database-governance',
      projectId,
      assignedAgentId: 'software-engineer',
      title: `Migration Proposal: ${title}`,
      description: `Awaiting mandatory Owner approval for ${inspection.verb || 'SQL'} migration.`,
      actionType,
      riskLevel: 'critical',
      approvalRequirement: 'mandatory',
      status: 'awaiting_approval',
      progressPercent: 0,
      currentStage: 'Awaiting migration approval',
      attempts: 0,
      maxAttempts: 3,
      outputReport: null,
      errorMessage: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    };

    const approval: ApprovalRecord = {
      id: approvalId,
      taskId,
      projectId,
      requestedByAgentId: 'software-engineer',
      actionType,
      riskLevel: 'critical',
      title: `${isDeletion ? 'Destructive SQL Gate' : 'Database Migration'}: ${title}`,
      summary: `Mandatory Owner approval required before executing ${inspection.verb || 'SQL'} on ${projectId}.`,
      payloadPreview: sql,
      status: 'pending',
      decidedBy: null,
      decisionNote: null,
      createdAt: now,
      decidedAt: null,
    };

    palashStore.mutate((snap) => {
      snap.tasks.unshift(task);
      snap.approvals.unshift(approval);
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'MIGRATION_APPROVAL_QUEUED',
      resource: projectId,
      outcome: 'pending',
      ip: getClientIp(req),
      details: `Queued mandatory Owner approval for migration "${title}".`,
    });

    res.status(201).json({ task, approval });
  });

  // ---------------------------------------------------------------------------
  // Backups: real snapshot files on disk (the previous implementation only wrote
  // a memory record, so nothing was ever recoverable).
  // ---------------------------------------------------------------------------
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');
  const MAX_BACKUPS = 20;
  const BACKUP_FILE_PATTERN = /^backup-[A-Za-z0-9._-]+\.json$/;

  function listBackups(): Array<{
    id: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  }> {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((name) => BACKUP_FILE_PATTERN.test(name))
      .map((name) => {
        const full = path.join(BACKUP_DIR, name);
        const content = fs.readFileSync(full);
        const stat = fs.statSync(full);
        return {
          id: name,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  app.post('/api/system/backup', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const now = new Date().toISOString();
    const snapshot = palashStore.exportSnapshot();
    const sha256 = crypto.createHash('sha256').update(snapshot).digest('hex');
    const fileName = `backup-${now.replace(/[:.]/g, '-')}.json`;
    const fullPath = path.join(BACKUP_DIR, fileName);

    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.writeFileSync(fullPath, snapshot, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      res.status(500).json({
        error: `Unable to write backup file: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
      return;
    }

    // Verify what actually landed on disk before claiming success.
    const written = fs.readFileSync(fullPath);
    const verifiedSha256 = crypto.createHash('sha256').update(written).digest('hex');
    const verified = verifiedSha256 === sha256;

    // Keep the directory bounded.
    const backups = listBackups();
    for (const stale of backups.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, stale.id));
      } catch {
        // best effort
      }
    }

    const tablesCount = palashStore.listCanonicalTables().length;
    const totalRows = palashStore.listCanonicalTables().reduce((acc, t) => acc + t.rows, 0);
    const backupRecord = {
      id: newId('mem-bkp'),
      projectId: 'palash-ai',
      agentId: 'software-engineer' as const,
      category: 'backup' as const,
      title: `Backup Snapshot (${sha256.slice(0, 16)})`,
      content: `${fileName} · ${written.length} bytes · ${tablesCount} tables (${totalRows} records) · SHA-256 ${sha256.slice(0, 16)}… · ${
        verified ? 'verified' : 'VERIFICATION FAILED'
      }`,
      createdAt: now,
    };

    palashStore.mutate((snap) => {
      snap.system.lastBackupAt = now;
      snap.agent_memory.unshift(backupRecord);
      if (snap.agent_memory.length > 500) {
        snap.agent_memory = snap.agent_memory.slice(0, 500);
      }
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'BACKUP_CREATED',
      resource: 'palash_ai_schema',
      outcome: verified ? 'success' : 'error',
      ip: getClientIp(req),
      details: backupRecord.content,
    });

    res.status(verified ? 201 : 500).json({
      backup: backupRecord,
      lastBackupAt: now,
      file: fileName,
      sizeBytes: written.length,
      sha256,
      verified,
    });
  });

  app.get('/api/system/backups', requireAuth, requireOwner, (_req, res) => {
    res.json({
      backups: listBackups(),
      directory: path.relative(process.cwd(), BACKUP_DIR) || '.data/backups',
      retention: MAX_BACKUPS,
    });
  });

  app.post(
    '/api/system/backups/:id/restore',
    requireAuth,
    requireOwner,
    (req: AuthenticatedRequest, res) => {
      const id = String(req.params.id || '');
      if (!BACKUP_FILE_PATTERN.test(id)) {
        res.status(400).json({ error: 'Invalid backup identifier.' });
        return;
      }
      if (req.body?.confirm !== true) {
        res.status(400).json({
          error: 'Restoring overwrites current state. Resend with {"confirm": true}.',
        });
        return;
      }
      const fullPath = path.join(BACKUP_DIR, id);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'Backup file not found.' });
        return;
      }
      try {
        palashStore.restoreSnapshot(fs.readFileSync(fullPath, 'utf8'));
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Backup could not be restored.',
        });
        return;
      }
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'BACKUP_RESTORED',
        resource: 'palash_ai_schema',
        outcome: 'success',
        ip: getClientIp(req),
        details: `State restored from ${id}.`,
      });
      res.json({ restored: true, backupId: id, restoredAt: new Date().toISOString() });
    }
  );

  app.get('/api/finance/summary', requireAuth, (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : 'all';
    const db = palashStore.getSnapshot();
    const summary = computeFinancialSummary(db.ledger_entries, db.budget_targets, projectId);
    const entries =
      projectId === 'all'
        ? db.ledger_entries
        : db.ledger_entries.filter((e) => e.projectId === projectId);
    res.json({ summary, entries, targets: db.budget_targets });
  });

  app.post('/api/finance/entries', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'musafir-cafe-pos';
    const type = req.body?.type;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const amount = Number(req.body?.amount);
    const date = typeof req.body?.date === 'string' && req.body.date ? req.body.date : new Date().toISOString().slice(0, 10);

    if (!['revenue', 'expense', 'staff_cost', 'inventory'].includes(type)) {
      res.status(400).json({ error: 'Invalid ledger entry type.' });
      return;
    }
    if (!category || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Category and a positive numeric amount are required.' });
      return;
    }

    const entry = {
      id: newId('led'),
      projectId,
      type: type as 'revenue' | 'expense' | 'staff_cost' | 'inventory',
      category,
      description: description || category,
      amount: Number(amount.toFixed(2)),
      currency: 'USD',
      date,
      createdAt: new Date().toISOString(),
    };

    palashStore.mutate((snap) => {
      snap.ledger_entries.unshift(entry);
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'LEDGER_ENTRY_ADDED',
      resource: `${projectId}/${type}`,
      outcome: 'success',
      ip: getClientIp(req),
      details: `${type.toUpperCase()} $${entry.amount} — ${category}`,
    });

    const db = palashStore.getSnapshot();
    res.status(201).json({
      entry,
      summary: computeFinancialSummary(db.ledger_entries, db.budget_targets, 'all'),
    });
  });

  // Phase 9: Monitoring, Audit Logs & Memory
  app.get('/api/monitoring/metrics', requireAuth, async (_req, res) => {
    const db = palashStore.getSnapshot();
    const pgHealth = await checkPostgresHealth();
    const uptimeSec = Math.round(process.uptime());
    const mem = process.memoryUsage();
    res.json({
      uptimeSec,
      memoryMb: Math.round(mem.rss / 1024 / 1024),
      apiMetrics: db.system.apiMetrics,
      lastBackupAt: db.system.lastBackupAt,
      emergencyStop: db.system.emergencyStop,
      postgres: pgHealth,
      agentStats: db.agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        completedTasks: a.completedTasks,
        failedTasks: a.failedTasks,
        avgLatencyMs: a.avgLatencyMs,
      })),
    });
  });

  app.get('/api/audit-logs', requireAuth, (_req, res) => {
    res.json({ logs: palashStore.getSnapshot().audit_logs });
  });

  app.get('/api/memory', requireAuth, (_req, res) => {
    res.json({ memories: palashStore.getSnapshot().agent_memory });
  });

  // Phase 10: Production Readiness Audit
  app.get('/api/system/readiness', requireAuth, async (_req, res) => {
    const db = palashStore.getSnapshot();
    const pgHealth = await checkPostgresHealth();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY?.trim() !== 'MY_GEMINI_API_KEY'
    );
    const checks = [
      {
        id: 'owner-auth',
        label: 'Owner Authentication & Scrypt Hashing',
        passed: db.users.some((u) => u.role === 'owner') || hasEnvAdminConfigured(),
        detail: hasEnvAdminConfigured()
          ? 'Configured via ADMIN_EMAIL / ADMIN_PASSWORD'
          : 'Claimed Owner account active',
      },
      {
        id: 'db-tables',
        label: '7-Table Relational Schema Initialized',
        passed: palashStore.listCanonicalTables().length === 7,
        detail: `${palashStore.listCanonicalTables().length} core tables verified`,
      },
      {
        id: 'agent-roster',
        label: 'Chief Agent + 6 Specialist Workers',
        passed: db.agents.length === 7,
        detail: `${db.agents.length} agents registered`,
      },
      {
        id: 'approval-gates',
        label: 'Mandatory Human Approval Policy Matrix',
        passed: Object.keys(APPROVAL_POLICY_MATRIX).length === 10,
        detail: 'High-risk actions gated for Owner sign-off',
      },
      {
        id: 'gemini-provider',
        label: 'Server-Side Gemini AI Provider',
        passed: geminiConfigured,
        detail: geminiConfigured ? 'GEMINI_API_KEY active' : 'Add GEMINI_API_KEY in Secrets',
      },
      {
        id: 'neon-postgres',
        label: 'External Neon PostgreSQL 17 Bridge',
        passed: pgHealth.connected,
        detail: pgHealth.connected
          ? `Connected (${pgHealth.database})`
          : 'Optional: set DATABASE_URL in Secrets to switch from local store',
      },
      {
        id: 'github-token',
        label: 'GitHub Private Repository Access',
        passed: Boolean(process.env.GITHUB_TOKEN?.trim()),
        detail: process.env.GITHUB_TOKEN?.trim()
          ? 'GITHUB_TOKEN configured'
          : 'Optional: public repos active; add GITHUB_TOKEN for private repos',
      },
      {
        id: 'backup-verified',
        label: 'Verified Backup Snapshot',
        passed: Boolean(db.system.lastBackupAt),
        detail: db.system.lastBackupAt
          ? `Last verified ${new Date(db.system.lastBackupAt).toLocaleString()}`
          : 'Run backup snapshot in Database Console',
      },
    ];

    res.json({
      checks,
      coreReady: checks.slice(0, 5).every((c) => c.passed),
      timestamp: new Date().toISOString(),
    });
  });

  // Unknown /api/* paths must be JSON 404s. Without this, the SPA fallback
  // answered typos like /api/overiview with 200 + index.html.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV === 'test') {
    // Tests import createApp() and exercise the API only: starting Vite would
    // spawn a watcher/HMR socket that keeps the process alive.
  } else if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  return app;
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPoint || process.env.PALASH_START_SERVER === '1') {
  createApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`PALASH AI listening on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start PALASH AI:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
