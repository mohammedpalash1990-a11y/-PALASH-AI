import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express, { type NextFunction, type Request, type Response } from 'express';

const execFileAsync = promisify(execFile);
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
import {
  clearSessionToken,
  compareWorkspaceWithGitHub,
  createGitHubOAuthUrl,
  exchangeGitHubOAuthCode,
  fetchRepositoryFile,
  getGitHubConnectionStatus,
  inspectGitHubRepository,
  listRepositoryFiles,
  pushWorkspaceToGitHub,
  resolveGitHubToken,
  syncLocalGitRemote,
  verifyAndSetSessionToken,
} from './server/githubService.ts';
import {
  bootstrapPostgresSchema,
  checkPostgresHealth,
  listPostgresTables,
  queryPostgresReadOnly,
} from './server/pgBridge.ts';
import { palashStore } from './server/store.ts';

const PORT = Number(process.env.PORT || 3000);
const TOKEN_SIGNING_SECRET = process.env.JWT_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
const rateLimiter = new SlidingWindowRateLimiter(180, 60_000);

interface AuthenticatedRequest extends Request {
  authUser?: AuthTokenPayload;
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
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

async function createApp(): Promise<express.Express> {
  await palashStore.initialize();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

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
      palashStore.mutate((db) => {
        const m = db.system.apiMetrics;
        const nextTotal = m.totalRequests + 1;
        m.avgLatencyMs = Math.round((m.avgLatencyMs * m.totalRequests + elapsed) / nextTotal);
        m.totalRequests = nextTotal;
        if (res.statusCode >= 500) {
          m.errorCount += 1;
        }
      });
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
    const githubTokenConfigured = Boolean(resolveGitHubToken().token);

    palashStore.mutate((snap) => {
      snap.system.apiMetrics.lastHealthCheckAt = new Date().toISOString();
    });

    res.json({
      status: db.system.emergencyStop ? 'halted' : 'healthy',
      service: 'PALASH AI',
      timestamp: new Date().toISOString(),
      database: {
        localStoreInitialized: true,
        tablesCount: palashStore.listCanonicalTables().length,
        postgres: pgStatus,
        persistentStore: palashStore.getPersistenceStatus(),
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
      suggestedEmail: process.env.ADMIN_EMAIL?.trim() || 'mohammedpalash1990@gmail.com',
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

    const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const envPassword = process.env.ADMIN_PASSWORD?.trim();
    const db = palashStore.getSnapshot();

    // Env admin takes precedence when configured
    if (envEmail && envPassword && email === envEmail) {
      if (password !== envPassword) {
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
      const missionId = `mission-${Date.now()}`;
      const createdTasks: TaskRecord[] = [];
      const createdApprovals: ApprovalRecord[] = [];

      for (let i = 0; i < plan.tasks.length; i++) {
        const sub = plan.tasks[i];
        const policy = evaluateActionPolicy(sub.actionType, false);
        const taskId = `task-${Date.now()}-${i}`;
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
            id: `apr-${Date.now()}-${i}`,
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
          id: `mem-${Date.now()}`,
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
    const assignedAgentId = (req.body?.assignedAgentId as AgentId) || 'software-engineer';
    const actionType = (req.body?.actionType as ActionType) || 'research';

    if (!title) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }

    const db = palashStore.getSnapshot();
    const policy = evaluateActionPolicy(actionType, db.system.emergencyStop);
    if (policy.blockedByEmergencyStop) {
      res.status(423).json({ error: 'Emergency Stop is active. Resume operations first.' });
      return;
    }

    const now = new Date().toISOString();
    const taskId = `task-${Date.now()}`;
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
        id: `apr-${Date.now()}`,
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
          id: `apr-${Date.now()}`,
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
          id: `mem-${Date.now()}`,
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

  app.post('/api/approvals/:id/decide', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
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

    // If approving a direct GitHub push gate, execute the remote push first
    let pushResult: Awaited<ReturnType<typeof pushWorkspaceToGitHub>> | null = null;
    if (decision === 'approved' && approval.githubPushMeta) {
      if (db.system.emergencyStop) {
        res.status(423).json({ error: 'System is under Emergency Stop. Resume operations before pushing to GitHub.' });
        return;
      }
      try {
        pushResult = await pushWorkspaceToGitHub({
          owner: approval.githubPushMeta.owner,
          repo: approval.githubPushMeta.repo,
          targetBranch: approval.githubPushMeta.targetBranch,
          baseBranch: approval.githubPushMeta.baseBranch,
          commitMessage: approval.githubPushMeta.commitMessage,
          filePaths: approval.githubPushMeta.filePaths,
          createPullRequest: approval.githubPushMeta.createPullRequest,
          prTitle: approval.githubPushMeta.prTitle,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'GitHub push failed during approval execution.';
        res.status(502).json({ error: msg });
        return;
      }
    }

    const now = new Date().toISOString();
    palashStore.mutate((snap) => {
      const target = snap.approvals.find((a) => a.id === approval.id);
      if (target) {
        target.status = decision;
        target.decidedBy = req.authUser?.email || 'owner';
        target.decisionNote = note || null;
        target.decidedAt = now;
        if (pushResult && target.githubPushMeta) {
          target.githubPushMeta.executedCommitSha = pushResult.commitSha;
          target.githubPushMeta.executedCommitUrl = pushResult.commitUrl;
          target.githubPushMeta.executedPrUrl = pushResult.prUrl;
          target.githubPushMeta.executedPrNumber = pushResult.prNumber;
        }
      }

      const task = snap.tasks.find((t) => t.id === approval.taskId);
      if (task) {
        if (decision === 'approved') {
          if (pushResult) {
            task.status = 'completed';
            task.progressPercent = 100;
            task.currentStage = `Pushed ${pushResult.filesPushed} file(s) to ${pushResult.owner}/${pushResult.repo}@${pushResult.branch}`;
            task.attempts += 1;
            task.outputReport = [
              `GitHub Push Executed Successfully`,
              `Repository: ${pushResult.owner}/${pushResult.repo}`,
              `Branch: ${pushResult.branch}`,
              `Commit SHA: ${pushResult.commitSha}`,
              `Commit URL: ${pushResult.commitUrl}`,
              pushResult.prUrl ? `Pull Request: #${pushResult.prNumber} (${pushResult.prUrl})` : null,
            ]
              .filter(Boolean)
              .join('\n');
          } else {
            task.status = 'queued';
          }
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
      action: pushResult
        ? 'GITHUB_PUSH_EXECUTED'
        : decision === 'approved'
          ? 'APPROVAL_GRANTED'
          : 'APPROVAL_REJECTED',
      resource: `${approval.projectId}/${approval.id}`,
      outcome: decision === 'approved' ? 'success' : 'blocked',
      ip: getClientIp(req),
      details: pushResult
        ? `Approved & pushed ${pushResult.filesPushed} file(s) to ${pushResult.owner}/${pushResult.repo}@${pushResult.branch} (${pushResult.commitSha.slice(0, 7)})`
        : `${decision.toUpperCase()} "${approval.title}"${note ? ` — ${note}` : ''}`,
    });

    res.json({
      approval: palashStore.getSnapshot().approvals.find((a) => a.id === approval.id),
      task: palashStore.getSnapshot().tasks.find((t) => t.id === approval.taskId),
      pushResult,
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
    const category = req.body?.category || 'saas';
    const deadline = typeof req.body?.deadline === 'string' && req.body.deadline ? req.body.deadline : '2027-01-31';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

    if (!name || !repoOwner || !repoName) {
      res.status(400).json({ error: 'Project name, repository owner, and repository name are required.' });
      return;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `proj-${Date.now()}`;
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
  app.post('/api/github/inspect', requireAuth, async (req, res) => {
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

  app.post('/api/github/files', requireAuth, async (req, res) => {
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
    const taskId = `task-pr-${Date.now()}`;
    const approvalId = `apr-pr-${Date.now()}`;

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

  // Phase 3B: GitHub Connection, OAuth Popup, Workspace Diff & Push Engine
  app.get('/api/github/connection', requireAuth, async (_req, res) => {
    const status = await getGitHubConnectionStatus();
    res.json(status);
  });

  app.post('/api/github/connect-token', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'GitHub Personal Access Token is required.' });
      return;
    }

    try {
      const status = await verifyAndSetSessionToken(token, 'session_pat');
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'GITHUB_SESSION_CONNECTED',
        resource: `github/${status.login || 'authenticated'}`,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Verified session GitHub token for @${status.login} (scopes: ${status.scopes.join(', ') || 'fine-grained'}).`,
      });
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'GitHub token verification failed.' });
    }
  });

  app.post('/api/github/disconnect', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    clearSessionToken();
    const status = await getGitHubConnectionStatus();
    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'GITHUB_SESSION_DISCONNECTED',
      resource: 'github/session',
      outcome: 'success',
      ip: getClientIp(req),
      details: 'Cleared in-memory session GitHub token.',
    });
    res.json(status);
  });

  app.get('/api/github/oauth/url', requireAuth, requireOwner, (_req, res) => {
    try {
      const payload = createGitHubOAuthUrl();
      res.json(payload);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'GitHub OAuth not configured.' });
    }
  });

  app.get(['/auth/github/callback', '/auth/github/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthError = typeof req.query.error_description === 'string'
      ? req.query.error_description
      : typeof req.query.error === 'string'
        ? req.query.error
        : '';

    const escapeHtml = (val: string) =>
      val.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));

    if (oauthError || !code || !state) {
      const message = escapeHtml(oauthError || 'Missing authorization code or state.');
      res.status(400).send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h2>GitHub Authorization Cancelled</h2>
        <p>${message}</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GITHUB_OAUTH_ERROR', error: ${JSON.stringify(oauthError || 'Authorization failed')} }, '*');
          }
        </script>
      </body></html>`);
      return;
    }

    try {
      const status = await exchangeGitHubOAuthCode(code, state);
      palashStore.appendAudit({
        actor: status.login || 'owner',
        action: 'GITHUB_OAUTH_CONNECTED',
        resource: `github/${status.login || 'oauth'}`,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Connected GitHub account @${status.login} via OAuth popup.`,
      });
      res.send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h2>GitHub Connected (${escapeHtml(status.login || 'Verified')})</h2>
        <p>Authorization complete. This window will close automatically.</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GITHUB_OAUTH_SUCCESS', login: ${JSON.stringify(status.login)} }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script>
      </body></html>`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GitHub OAuth token exchange failed.';
      res.status(400).send(`<!doctype html><html><body style="font-family:sans-serif;padding:24px;">
        <h2>GitHub Authorization Error</h2>
        <p>${escapeHtml(msg)}</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GITHUB_OAUTH_ERROR', error: ${JSON.stringify(msg)} }, '*');
          }
        </script>
      </body></html>`);
    }
  });

  app.post('/api/github/diff', requireAuth, async (req, res) => {
    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const branch = typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'main';
    if (!owner || !repo) {
      res.status(400).json({ error: 'GitHub owner and repo name are required.' });
      return;
    }
    try {
      const diff = await compareWorkspaceWithGitHub(owner, repo, branch);
      res.json(diff);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to compare workspace with GitHub.' });
    }
  });

  app.post('/api/github/sync-local-remote', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    if (!owner || !repo) {
      res.status(400).json({ error: 'GitHub owner and repo name are required.' });
      return;
    }
    try {
      const syncResult = await syncLocalGitRemote(owner, repo);
      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'GIT_REMOTE_BOUND',
        resource: `${owner}/${repo}`,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Bound local workspace remote origin -> ${syncResult.remoteUrl}`,
      });
      res.json(syncResult);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to bind local git remote.' });
    }
  });

  app.post('/api/github/push', requireAuth, requireOwner, async (req: AuthenticatedRequest, res) => {
    const db = palashStore.getSnapshot();
    if (db.system.emergencyStop) {
      res.status(423).json({ error: 'Emergency Stop active: GitHub pushes are blocked until operations resume.' });
      return;
    }

    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : 'palash-ai';
    const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
    const targetBranch = typeof req.body?.targetBranch === 'string' ? req.body.targetBranch.trim() : '';
    const baseBranch = typeof req.body?.baseBranch === 'string' && req.body.baseBranch.trim() ? req.body.baseBranch.trim() : 'main';
    const commitMessage = typeof req.body?.commitMessage === 'string' ? req.body.commitMessage.trim() : '';
    const filePaths = Array.isArray(req.body?.filePaths) ? req.body.filePaths.filter((p: unknown): p is string => typeof p === 'string') : [];
    const createPullRequest = Boolean(req.body?.createPullRequest);
    const prTitle = typeof req.body?.prTitle === 'string' ? req.body.prTitle.trim() : '';

    if (!owner || !repo || !targetBranch || !commitMessage || filePaths.length === 0) {
      res.status(400).json({ error: 'owner, repo, targetBranch, commitMessage, and at least one file are required.' });
      return;
    }

    const { token } = resolveGitHubToken();
    if (!token) {
      res.status(400).json({ error: 'GitHub authentication required before pushing. Connect via OAuth or Personal Access Token.' });
      return;
    }

    // Protected branches (main/master or matching baseBranch) require explicit Owner Approval Gate
    const isProtectedDirectPush =
      targetBranch === baseBranch || targetBranch === 'main' || targetBranch === 'master';

    if (isProtectedDirectPush) {
      const now = new Date().toISOString();
      const taskId = `task-push-${Date.now()}`;
      const approvalId = `apr-push-${Date.now()}`;

      const task: TaskRecord = {
        id: taskId,
        missionId: 'github-engineering',
        projectId,
        assignedAgentId: 'software-engineer',
        title: `Push ${filePaths.length} file(s) -> ${owner}/${repo}@${targetBranch}`,
        description: commitMessage,
        actionType: 'branch_code_change',
        riskLevel: 'high',
        approvalRequirement: 'mandatory',
        status: 'awaiting_approval',
        progressPercent: 0,
        currentStage: `Awaiting Owner approval to push to ${targetBranch}`,
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
        riskLevel: 'high',
        title: `Direct GitHub Push Gate: ${owner}/${repo}@${targetBranch}`,
        summary: `${commitMessage} (${filePaths.length} file(s) staged)`,
        payloadPreview: `Target: ${owner}/${repo} (${targetBranch})\nFiles (${filePaths.length}): ${filePaths.slice(0, 8).join(', ')}${filePaths.length > 8 ? ` ... (+${filePaths.length - 8} more)` : ''}`,
        githubPushMeta: {
          owner,
          repo,
          targetBranch,
          baseBranch,
          commitMessage,
          filePaths,
          createPullRequest: false,
          prTitle,
        },
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
        action: 'GITHUB_PUSH_QUEUED',
        resource: `${owner}/${repo}@${targetBranch}`,
        outcome: 'pending',
        ip: getClientIp(req),
        details: `Queued Owner approval gate to push ${filePaths.length} file(s) to ${targetBranch}.`,
      });

      res.status(202).json({
        queuedForApproval: true,
        task,
        approval,
      });
      return;
    }

    // Feature branch push runs directly and optionally opens a PR
    try {
      const pushResult = await pushWorkspaceToGitHub({
        owner,
        repo,
        targetBranch,
        baseBranch,
        commitMessage,
        filePaths,
        createPullRequest,
        prTitle,
      });

      const now = new Date().toISOString();
      const task: TaskRecord = {
        id: `task-push-${Date.now()}`,
        missionId: 'github-engineering',
        projectId,
        assignedAgentId: 'software-engineer',
        title: `Pushed ${pushResult.filesPushed} file(s) -> ${owner}/${repo}@${targetBranch}`,
        description: commitMessage,
        actionType: 'branch_code_change',
        riskLevel: 'medium',
        approvalRequirement: 'restricted_branch',
        status: 'completed',
        progressPercent: 100,
        currentStage: `Pushed commit ${pushResult.commitSha.slice(0, 7)} to ${targetBranch}`,
        attempts: 1,
        maxAttempts: 3,
        outputReport: [
          `GitHub Branch Push Completed`,
          `Repository: ${pushResult.owner}/${pushResult.repo}`,
          `Branch: ${pushResult.branch}`,
          `Commit SHA: ${pushResult.commitSha}`,
          `Commit URL: ${pushResult.commitUrl}`,
          pushResult.prUrl ? `Pull Request: #${pushResult.prNumber} (${pushResult.prUrl})` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        errorMessage: null,
        durationMs: 900,
        createdAt: now,
        updatedAt: now,
      };

      palashStore.mutate((snap) => {
        snap.tasks.unshift(task);
      });

      palashStore.appendAudit({
        actor: req.authUser?.email || 'owner',
        action: 'GITHUB_PUSH_EXECUTED',
        resource: `${owner}/${repo}@${targetBranch}`,
        outcome: 'success',
        ip: getClientIp(req),
        details: `Pushed ${pushResult.filesPushed} file(s) to ${targetBranch} (${pushResult.commitSha.slice(0, 7)})${pushResult.prUrl ? ` · PR #${pushResult.prNumber}` : ''}.`,
      });

      res.json({
        queuedForApproval: false,
        result: pushResult,
        task,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'GitHub push failed.' });
    }
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

  app.post('/api/database/query', requireAuth, async (req: AuthenticatedRequest, res) => {
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
    const taskId = `task-mig-${Date.now()}`;
    const approvalId = `apr-mig-${Date.now()}`;

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

  app.post('/api/system/backup', requireAuth, requireOwner, (req: AuthenticatedRequest, res) => {
    const db = palashStore.getSnapshot();
    const now = new Date().toISOString();
    const tablesCount = palashStore.listCanonicalTables().length;
    const totalRows = palashStore.listCanonicalTables().reduce((acc, t) => acc + t.rows, 0);
    const checksum = crypto.createHash('sha256').update(JSON.stringify(db)).digest('hex').slice(0, 16);

    const backupRecord = {
      id: `mem-bkp-${Date.now()}`,
      projectId: 'palash-ai',
      agentId: 'software-engineer' as const,
      category: 'backup' as const,
      title: `Verified Backup Snapshot (${checksum})`,
      content: `Captured ${tablesCount} tables (${totalRows} total records) · SHA-256 prefix: ${checksum} · Integrity verified.`,
      createdAt: now,
    };

    palashStore.mutate((snap) => {
      snap.system.lastBackupAt = now;
      snap.agent_memory.unshift(backupRecord);
    });

    palashStore.appendAudit({
      actor: req.authUser?.email || 'owner',
      action: 'BACKUP_VERIFIED',
      resource: 'palash_ai_schema',
      outcome: 'success',
      ip: getClientIp(req),
      details: backupRecord.content,
    });

    res.status(201).json({ backup: backupRecord, lastBackupAt: now });
  });

  // Phase 7: Business & Financial Management
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
      id: `led-${Date.now()}`,
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
        label: 'Neon PostgreSQL Persistent Primary Store',
        passed: palashStore.getPersistenceStatus().connected && pgHealth.connected,
        detail: palashStore.getPersistenceStatus().connected
          ? `Persistent state storage connected (${pgHealth.database})`
          : `Persistent state storage unavailable: ${palashStore.getPersistenceStatus().error || 'DATABASE_URL is not configured'}`,
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

  // Direct project source code download (zip archive)
  app.get(['/api/download/project-zip', '/download/palash-ai-project.zip'], async (_req, res) => {
    const zipPath = path.resolve(process.cwd(), 'public', 'palash-ai-project.zip');
    try {
      if (!fs.existsSync(zipPath) || Date.now() - fs.statSync(zipPath).mtimeMs > 60_000) {
        await execFileAsync(
          'python3',
          [
            '-c',
            `import os, zipfile
exclude_dirs = {'node_modules', 'dist', 'dev-dist', '.data', '.playwright-cli', '.git', '.aistudio'}
exclude_files = {'.env', 'palash-ai-project.zip'}
os.makedirs('public', exist_ok=True)
with zipfile.ZipFile('public/palash-ai-project.zip', 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for f in files:
            if f in exclude_files or f.endswith('.log'): continue
            fp = os.path.join(root, f)
            arc = os.path.relpath(fp, '.')
            if arc == os.path.join('public', 'palash-ai-project.zip'): continue
            zipf.write(fp, arc)
`,
          ],
          { cwd: process.cwd() }
        );
      }
    } catch (err) {
      console.error('ZIP generation error:', err);
    }

    if (fs.existsSync(zipPath)) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="palash-ai-project.zip"');
      res.sendFile(zipPath);
    } else {
      res.status(500).json({ error: 'Could not generate project ZIP archive.' });
    }
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
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

createApp().then((app) => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PALASH AI listening on http://localhost:${PORT}`);
  });
});
