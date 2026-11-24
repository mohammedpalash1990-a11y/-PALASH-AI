import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CANONICAL_AGENTS } from './core/orchestrator.ts';
import { hashPassword, verifyPassword } from './core/security.ts';
import type {
  AuditLogRecord,
  PalashDatabase,
  ProjectRecord,
  TaskRecord,
} from './core/types.ts';

export const DATA_DIR = path.resolve(process.env.PALASH_DATA_DIR || path.join(process.cwd(), '.data'));
const STATE_FILE = path.join(DATA_DIR, 'palash-state.json');

function createSeedDatabase(): PalashDatabase {
  const now = new Date().toISOString();
  const projects: ProjectRecord[] = [
    {
      id: 'palash-ai',
      name: 'PALASH AI',
      slug: 'mohammedpalash1990-a11y/-PALASH-AI',
      category: 'platform',
      repoOwner: 'mohammedpalash1990-a11y',
      repoName: '-PALASH-AI',
      defaultBranch: 'main',
      permissionScope: 'full-control',
      dbIsolationLabel: 'palash_ai (Neon PG 17 · Primary)',
      deploymentPolicy: 'mandatory-owner-approval',
      status: 'active',
      progress: 72,
      deadline: '2026-12-15',
      description: 'Core Autonomous AI Agent Platform, Multi-Agent Engine, Approval Matrix & PWA.',
      updatedAt: now,
    },
    {
      id: 'musafir-cafe-pos',
      name: 'Musafir Cafe POS',
      slug: 'mohammedpalash1990-a11y/musafir-cafe-pos',
      category: 'pos',
      repoOwner: 'mohammedpalash1990-a11y',
      repoName: 'musafir-cafe-pos',
      defaultBranch: 'main',
      permissionScope: 'branch-only-with-approval',
      dbIsolationLabel: 'musafir_pos_isolated (Protected)',
      deploymentPolicy: 'mandatory-owner-approval',
      status: 'active',
      progress: 84,
      deadline: '2026-12-05',
      description: 'Cafe point-of-sale billing, table management, inventory & daily cash reconciliation.',
      updatedAt: now,
    },
    {
      id: 'saudi-fast-food-pos',
      name: 'Saudi Fast Food POS',
      slug: 'mohammedpalash1990-a11y/Fast-Food-Pos',
      category: 'pos',
      repoOwner: 'mohammedpalash1990-a11y',
      repoName: 'Fast-Food-Pos',
      defaultBranch: 'main',
      permissionScope: 'branch-only-with-approval',
      dbIsolationLabel: 'saudi_pos_isolated (Protected)',
      deploymentPolicy: 'mandatory-owner-approval',
      status: 'attention',
      progress: 68,
      deadline: '2026-12-10',
      description: 'High-throughput kitchen display, VAT receipt compliance, and branch shift operations.',
      updatedAt: now,
    },
    {
      id: 'deenverse',
      name: 'Deenverse',
      slug: 'mohammedpalash1990-a11y/deenverse',
      category: 'saas',
      repoOwner: 'mohammedpalash1990-a11y',
      repoName: 'deenverse',
      defaultBranch: 'main',
      permissionScope: 'branch-only-with-approval',
      dbIsolationLabel: 'deenverse_isolated (Protected)',
      deploymentPolicy: 'staging-auto-prod-approval',
      status: 'active',
      progress: 76,
      deadline: '2026-12-20',
      description: 'Digital community knowledge platform, content pipelines, and mobile web experience.',
      updatedAt: now,
    },
    {
      id: 'bangladesh-marketplace',
      name: 'Bangladesh Marketplace',
      slug: 'mohammedpalash1990-a11y/bangladesh-marketplace',
      category: 'marketplace',
      repoOwner: 'mohammedpalash1990-a11y',
      repoName: 'bangladesh-marketplace',
      defaultBranch: 'main',
      permissionScope: 'read-analyze',
      dbIsolationLabel: 'bd_market_isolated (Protected)',
      deploymentPolicy: 'mandatory-owner-approval',
      status: 'maintenance',
      progress: 54,
      deadline: '2027-01-12',
      description: 'Multi-vendor marketplace catalog, seller payout auditing, and order fulfillment.',
      updatedAt: now,
    },
  ];

  const tasks: TaskRecord[] = [
    {
      id: 'task-init-1',
      missionId: 'mission-bootstrap',
      projectId: 'palash-ai',
      assignedAgentId: 'quality-auditor',
      title: 'Verify Phase 1 database schema and policy matrix',
      description: 'Audit all 7 canonical tables, RBAC boundaries, and approval policy triggers.',
      actionType: 'code_analysis',
      riskLevel: 'low',
      approvalRequirement: 'none',
      status: 'completed',
      progressPercent: 100,
      currentStage: 'Verified core tables, policy matrix, and agent boundaries',
      attempts: 1,
      maxAttempts: 3,
      outputReport: 'Verified 7 core tables, 7 agent records, and mandatory approval gates for high-risk actions.',
      errorMessage: null,
      durationMs: 312,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-init-2',
      missionId: 'mission-pos-audit',
      projectId: 'saudi-fast-food-pos',
      assignedAgentId: 'software-engineer',
      title: 'Prepare VAT receipt decimal rounding migration',
      description: 'Add precision(12,2) constraint on order_tax_sar column on feature branch before staging.',
      actionType: 'database_migration',
      riskLevel: 'critical',
      approvalRequirement: 'mandatory',
      status: 'awaiting_approval',
      progressPercent: 0,
      currentStage: 'Awaiting Owner migration sign-off',
      attempts: 0,
      maxAttempts: 3,
      outputReport: null,
      errorMessage: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-init-3',
      missionId: 'mission-cafe-ops',
      projectId: 'musafir-cafe-pos',
      assignedAgentId: 'finance-assistant',
      title: 'Reconcile weekly espresso & kitchen inventory margin',
      description: 'Cross-check POS gross revenue against supplier invoices and shift payroll.',
      actionType: 'research',
      riskLevel: 'low',
      approvalRequirement: 'none',
      status: 'queued',
      progressPercent: 0,
      currentStage: 'Queued in task backlog',
      attempts: 0,
      maxAttempts: 3,
      outputReport: null,
      errorMessage: null,
      durationMs: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const approvals = [
    {
      id: 'apr-init-1',
      taskId: 'task-init-2',
      projectId: 'saudi-fast-food-pos',
      requestedByAgentId: 'software-engineer' as const,
      actionType: 'database_migration' as const,
      riskLevel: 'critical' as const,
      title: 'Schema Migration: VAT receipt precision constraint',
      summary: 'Software Engineer requests Owner approval to stage ALTER TABLE orders ALTER COLUMN tax_amount TYPE NUMERIC(12,2).',
      payloadPreview: 'ALTER TABLE pos_orders ALTER COLUMN vat_sar TYPE NUMERIC(12,2) USING ROUND(vat_sar, 2);',
      status: 'pending' as const,
      decidedBy: null,
      decisionNote: null,
      createdAt: now,
      decidedAt: null,
    },
  ];

  const audit_logs: AuditLogRecord[] = [
    {
      id: 'aud-1',
      actor: 'system',
      action: 'INITIALIZE_DATABASE',
      resource: 'palash_ai_schema',
      outcome: 'success',
      ip: '127.0.0.1',
      details: 'Initialized 7 core tables, 7 agent records, and 5 isolated project contexts.',
      timestamp: now,
    },
    {
      id: 'aud-2',
      actor: 'software-engineer',
      action: 'REQUEST_APPROVAL',
      resource: 'saudi-fast-food-pos/database_migration',
      outcome: 'pending',
      ip: 'internal-worker',
      details: 'Queued mandatory Owner approval for VAT decimal migration.',
      timestamp: now,
    },
  ];

  const agent_memory = [
    {
      id: 'mem-1',
      projectId: 'palash-ai',
      agentId: 'chief-agent' as const,
      category: 'decision' as const,
      title: 'Infrastructure Isolation Rule',
      content: 'Never delete, replace, or reuse existing Render services or Neon databases of connected projects. Each project operates within its own permission scope.',
      createdAt: now,
    },
    {
      id: 'mem-2',
      projectId: 'musafir-cafe-pos',
      agentId: 'operations-manager' as const,
      category: 'context' as const,
      title: 'Peak Shift Window',
      content: 'Musafir Cafe peak ticket volume occurs 17:00-22:30 local time; avoid deployments during service hours.',
      createdAt: now,
    },
    {
      id: 'mem-3',
      projectId: 'palash-ai',
      agentId: 'software-engineer' as const,
      category: 'backup' as const,
      title: 'Initial Verified State Backup',
      content: 'Snapshot #001 verified across 7 tables with checksum integrity OK.',
      createdAt: now,
    },
  ];

  const ledger_entries = [
    {
      id: 'led-1',
      projectId: 'musafir-cafe-pos',
      type: 'revenue' as const,
      category: 'POS Beverage & Dining',
      description: 'Monthly counter & dine-in ticket settlements',
      amount: 18450,
      currency: 'USD',
      date: '2026-11-18',
      createdAt: now,
    },
    {
      id: 'led-2',
      projectId: 'musafir-cafe-pos',
      type: 'inventory' as const,
      category: 'Coffee & Kitchen Supply',
      description: 'Roastery beans, dairy, and packaging restock',
      amount: 5120,
      currency: 'USD',
      date: '2026-11-15',
      createdAt: now,
    },
    {
      id: 'led-3',
      projectId: 'musafir-cafe-pos',
      type: 'staff_cost' as const,
      category: 'Barista & Kitchen Payroll',
      description: 'Shift wages and supervisor allowance',
      amount: 4300,
      currency: 'USD',
      date: '2026-11-15',
      createdAt: now,
    },
    {
      id: 'led-4',
      projectId: 'saudi-fast-food-pos',
      type: 'revenue' as const,
      category: 'Fast Food Counter & Delivery',
      description: 'Branch POS gross sales settlements',
      amount: 26800,
      currency: 'USD',
      date: '2026-11-19',
      createdAt: now,
    },
    {
      id: 'led-5',
      projectId: 'saudi-fast-food-pos',
      type: 'inventory' as const,
      category: 'Protein & Packaging Stock',
      description: 'Weekly cold-chain procurement',
      amount: 8900,
      currency: 'USD',
      date: '2026-11-16',
      createdAt: now,
    },
    {
      id: 'led-6',
      projectId: 'saudi-fast-food-pos',
      type: 'staff_cost' as const,
      category: 'Branch Crew Payroll',
      description: 'Cashier, grill, and delivery dispatch team',
      amount: 6150,
      currency: 'USD',
      date: '2026-11-16',
      createdAt: now,
    },
    {
      id: 'led-7',
      projectId: 'deenverse',
      type: 'revenue' as const,
      category: 'Partner Sponsorships',
      description: 'Community directory & featured educational listings',
      amount: 4200,
      currency: 'USD',
      date: '2026-11-14',
      createdAt: now,
    },
    {
      id: 'led-8',
      projectId: 'palash-ai',
      type: 'expense' as const,
      category: 'Cloud & Domain Ops',
      description: 'Free-tier infrastructure compliance & domain renewal',
      amount: 140,
      currency: 'USD',
      date: '2026-11-10',
      createdAt: now,
    },
  ];

  const budget_targets = [
    { projectId: 'musafir-cafe-pos', monthlyBudget: 12000, revenueTarget: 22000, staffCostCap: 5000 },
    { projectId: 'saudi-fast-food-pos', monthlyBudget: 18000, revenueTarget: 30000, staffCostCap: 7000 },
    { projectId: 'deenverse', monthlyBudget: 1500, revenueTarget: 5500, staffCostCap: 800 },
    { projectId: 'bangladesh-marketplace', monthlyBudget: 2500, revenueTarget: 8000, staffCostCap: 1200 },
    { projectId: 'palash-ai', monthlyBudget: 500, revenueTarget: 2000, staffCostCap: 0 },
  ];

  const agents = CANONICAL_AGENTS.map((a) =>
    a.id === 'quality-auditor' ? { ...a, completedTasks: 1, lastActiveAt: now } : { ...a }
  );

  const users = [];
  const envEmail = process.env.ADMIN_EMAIL?.trim();
  const envPassword = process.env.ADMIN_PASSWORD?.trim();
  if (envEmail && envPassword) {
    users.push({
      id: 'usr-owner-1',
      email: envEmail.toLowerCase(),
      name: 'Palash Owner',
      role: 'owner' as const,
      passwordHash: hashPassword(envPassword),
      createdAt: now,
      lastLoginAt: null,
    });
  }

  return {
    users,
    projects,
    agents,
    tasks,
    approvals,
    audit_logs,
    agent_memory,
    ledger_entries,
    budget_targets,
    system: {
      emergencyStop: false,
      emergencyStopReason: null,
      emergencyStoppedAt: null,
      dbInitializedAt: now,
      lastBackupAt: now,
      apiMetrics: {
        totalRequests: 0,
        errorCount: 0,
        avgLatencyMs: 18,
        lastHealthCheckAt: now,
      },
    },
  };
}

class PalashStore {
  private data: PalashDatabase;

  constructor() {
    this.data = this.load();
    this.syncEnvAdmin();
  }

  private load(): PalashDatabase {
    if (fs.existsSync(STATE_FILE)) {
      let raw = '';
      try {
        raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as PalashDatabase;
        if (parsed && Array.isArray(parsed.agents) && Array.isArray(parsed.projects)) {
          return parsed;
        }
        throw new Error('state file is missing required collections');
      } catch (err) {
        // Never destroy the previous file silently: keep a timestamped copy so
        // the data can be recovered manually, and say so loudly.
        const backupPath = path.join(
          DATA_DIR,
          `palash-state.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
        try {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(backupPath, raw, 'utf8');
        } catch {
          // best effort
        }
        console.error(
          `[palash-store] State file was unreadable (${
            err instanceof Error ? err.message : String(err)
          }). Previous content preserved at ${backupPath}. Starting from seed state.`
        );
      }
    }
    const seed = createSeedDatabase();
    this.persist(seed);
    return seed;
  }

  private syncEnvAdmin(): void {
    const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const envPassword = process.env.ADMIN_PASSWORD?.trim();
    if (envEmail && envPassword) {
      const existingOwner = this.data.users.find((u) => u.role === 'owner');
      if (existingOwner && existingOwner.email.toLowerCase() === envEmail) {
        // Rotating ADMIN_PASSWORD in the environment must actually rotate the
        // stored credential, otherwise the old password keeps working forever.
        if (!verifyPassword(envPassword, existingOwner.passwordHash)) {
          existingOwner.passwordHash = hashPassword(envPassword);
          this.persist(this.data);
          console.warn('[palash-store] ADMIN_PASSWORD changed in environment; owner password rotated.');
        }
      }
      if (!existingOwner) {
        this.data.users.push({
          id: 'usr-owner-1',
          email: envEmail,
          name: 'Palash Owner',
          role: 'owner',
          passwordHash: hashPassword(envPassword),
          createdAt: new Date().toISOString(),
          lastLoginAt: null,
        });
        this.persist(this.data);
      }
    }
  }

  private persist(snapshot: PalashDatabase): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  }

  getSnapshot(): PalashDatabase {
    return this.data;
  }

  mutate(fn: (db: PalashDatabase) => void, options: { persist?: boolean } = {}): PalashDatabase {
    fn(this.data);
    // High-frequency callers (metrics on every request) can skip the disk write;
    // durable mutations keep the default.
    if (options.persist !== false) {
      this.persist(this.data);
    }
    return this.data;
  }

  /** Serialized snapshot for backups. */
  exportSnapshot(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Replace live state from a validated backup snapshot. */
  restoreSnapshot(raw: string): void {
    let parsed: PalashDatabase;
    try {
      parsed = JSON.parse(raw) as PalashDatabase;
    } catch {
      throw new Error('Backup file is not valid JSON.');
    }
    const required: Array<keyof PalashDatabase> = ['users', 'projects', 'agents', 'tasks', 'approvals'];
    for (const key of required) {
      if (!Array.isArray(parsed?.[key])) {
        throw new Error(`Backup is missing the "${key}" collection.`);
      }
    }
    this.data = parsed;
    this.persist(this.data);
  }

  appendAudit(entry: Omit<AuditLogRecord, 'id' | 'timestamp'>): AuditLogRecord {
    const record: AuditLogRecord = {
      ...entry,
      id: `aud-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    };
    this.mutate((db) => {
      db.audit_logs.unshift(record);
      if (db.audit_logs.length > 250) {
        db.audit_logs = db.audit_logs.slice(0, 250);
      }
    });
    return record;
  }

  listCanonicalTables(): Array<{ table: string; rows: number; columns: string[] }> {
    return [
      {
        table: 'users',
        rows: this.data.users.length,
        columns: ['id', 'email', 'name', 'role', 'createdAt', 'lastLoginAt'],
      },
      {
        table: 'projects',
        rows: this.data.projects.length,
        columns: ['id', 'name', 'slug', 'category', 'permissionScope', 'status', 'progress', 'deadline'],
      },
      {
        table: 'agents',
        rows: this.data.agents.length,
        columns: ['id', 'name', 'title', 'model', 'status', 'completedTasks', 'failedTasks', 'avgLatencyMs'],
      },
      {
        table: 'tasks',
        rows: this.data.tasks.length,
        columns: ['id', 'missionId', 'projectId', 'assignedAgentId', 'title', 'actionType', 'riskLevel', 'status', 'attempts'],
      },
      {
        table: 'approvals',
        rows: this.data.approvals.length,
        columns: ['id', 'taskId', 'projectId', 'requestedByAgentId', 'actionType', 'riskLevel', 'status', 'createdAt'],
      },
      {
        table: 'audit_logs',
        rows: this.data.audit_logs.length,
        columns: ['id', 'actor', 'action', 'resource', 'outcome', 'ip', 'timestamp'],
      },
      {
        table: 'agent_memory',
        rows: this.data.agent_memory.length,
        columns: ['id', 'projectId', 'agentId', 'category', 'title', 'createdAt'],
      },
    ];
  }

  executeSafeReadQuery(sql: string): {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
  } {
    const clean = sql.trim().replace(/;+\s*$/, '');
    if (/^SHOW\s+TABLES$/i.test(clean)) {
      const tables = this.listCanonicalTables().map((t) => ({
        table_name: t.table,
        row_count: t.rows,
        column_count: t.columns.length,
      }));
      return {
        columns: ['table_name', 'row_count', 'column_count'],
        rows: tables,
        rowCount: tables.length,
      };
    }

    if (/^EXPLAIN\s+/i.test(clean)) {
      return {
        columns: ['query_plan'],
        rows: [
          { query_plan: 'Seq Scan on palash_local_store (cost=0.00..1.12 rows=7 width=64)' },
          { query_plan: 'Safety Filter: read_only_verified = true' },
        ],
        rowCount: 2,
      };
    }

    const match = clean.match(
      /^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+([a-zA-Z0-9_]+)\s*=\s*['"]?([^'"\s]+)['"]?)?(?:\s+LIMIT\s+(\d+))?$/i
    );
    if (!match) {
      throw new Error(
        'Local query engine supports: SELECT <columns|*> FROM <table> [WHERE col = val] [LIMIT n], SHOW TABLES, or EXPLAIN <query>.'
      );
    }

    const [, rawCols, tableNameRaw, whereCol, whereVal, limitStr] = match;
    const tableName = tableNameRaw.toLowerCase();
    const tableMap: Record<string, Array<Record<string, unknown>>> = {
      users: this.data.users.map(({ passwordHash: _omitted, ...safeUser }) => safeUser),
      projects: this.data.projects as unknown as Array<Record<string, unknown>>,
      agents: this.data.agents as unknown as Array<Record<string, unknown>>,
      tasks: this.data.tasks as unknown as Array<Record<string, unknown>>,
      approvals: this.data.approvals as unknown as Array<Record<string, unknown>>,
      audit_logs: this.data.audit_logs as unknown as Array<Record<string, unknown>>,
      agent_memory: this.data.agent_memory as unknown as Array<Record<string, unknown>>,
    };

    const sourceRows = tableMap[tableName];
    if (!sourceRows) {
      throw new Error(`Unknown table "${tableName}". Available: ${Object.keys(tableMap).join(', ')}`);
    }

    let filtered = sourceRows;
    if (whereCol && whereVal !== undefined) {
      filtered = sourceRows.filter((r) => String(r[whereCol] ?? '') === whereVal);
    }

    const limit = limitStr ? Math.min(Number(limitStr), 100) : 50;
    const sliced = filtered.slice(0, limit);

    const requestedCols =
      rawCols.trim() === '*'
        ? Array.from(new Set(sliced.flatMap((r) => Object.keys(r))))
        : rawCols.split(',').map((c) => c.trim().replace(/^["'`]|["'`]$/g, ''));

    const projected = sliced.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of requestedCols) {
        out[col] = row[col] ?? null;
      }
      return out;
    });

    return {
      columns: requestedCols,
      rows: projected,
      rowCount: projected.length,
    };
  }
}

export const palashStore = new PalashStore();
