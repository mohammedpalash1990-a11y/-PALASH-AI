import type { ActionType, AgentId, AgentRecord, TaskRecord } from './types.ts';
import { evaluateActionPolicy } from './security.ts';

export const CANONICAL_AGENTS: AgentRecord[] = [
  {
    id: 'chief-agent',
    name: 'Chief Agent',
    title: 'Autonomous Orchestrator',
    specialty: 'Decision making, task decomposition, specialist delegation, approval gating, and executive reporting.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 680,
    capabilities: ['planning', 'routing', 'context_synthesis', 'approval_enforcement'],
    lastActiveAt: null,
  },
  {
    id: 'software-engineer',
    name: 'Software Engineer',
    title: 'Full-Stack & API Specialist',
    specialty: 'Code authoring, bug diagnosis, APIs, PostgreSQL schemas, and GitHub pull request preparation.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 920,
    capabilities: ['code_analysis', 'branch_code_change', 'database_migration', 'test_execution'],
    lastActiveAt: null,
  },
  {
    id: 'project-manager',
    name: 'Project Manager',
    title: 'Delivery & Milestone Lead',
    specialty: 'Project roadmaps, workload balancing, sprint deadlines, and progress tracking across repositories.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 540,
    capabilities: ['planning', 'research', 'deadline_monitoring'],
    lastActiveAt: null,
  },
  {
    id: 'business-analyst',
    name: 'Business Analyst',
    title: 'Strategy & Market Intelligence',
    specialty: 'Market viability, business diagnostics, customer conversion metrics, and growth recommendations.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 610,
    capabilities: ['research', 'planning', 'kpi_analysis'],
    lastActiveAt: null,
  },
  {
    id: 'finance-assistant',
    name: 'Finance Assistant',
    title: 'Accounting & Cash Flow Controller',
    specialty: 'Revenue/expense tracking, P&L statements, cash flow forecasting, staff costs, and budget control.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 510,
    capabilities: ['research', 'budget_audit', 'payment_purchase'],
    lastActiveAt: null,
  },
  {
    id: 'operations-manager',
    name: 'Operations Manager',
    title: 'Daily Operations Coordinator',
    specialty: 'POS workflows, inventory efficiency, vendor readiness, and routine operational execution.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 590,
    capabilities: ['research', 'planning', 'external_message'],
    lastActiveAt: null,
  },
  {
    id: 'quality-auditor',
    name: 'Quality Auditor',
    title: 'Security & QA Verifier',
    specialty: 'Automated test execution, security review, lint/build checks, and task verification.',
    model: 'gemini-4-hydrogen',
    status: 'ready',
    completedTasks: 0,
    failedTasks: 0,
    avgLatencyMs: 740,
    capabilities: ['code_analysis', 'test_execution', 'security_audit'],
    lastActiveAt: null,
  },
];

export function canRetryTask(task: TaskRecord): boolean {
  return task.status === 'failed' && task.attempts < task.maxAttempts;
}

export function transitionTaskForExecution(
  task: TaskRecord,
  emergencyStopActive: boolean,
  nowIso: string
): {
  nextTask: TaskRecord;
  needsApprovalRecord: boolean;
  blockedReason: string | null;
} {
  const policy = evaluateActionPolicy(task.actionType, emergencyStopActive);

  if (policy.blockedByEmergencyStop) {
    return {
      nextTask: {
        ...task,
        status: 'cancelled',
        errorMessage: 'Halted by Emergency Stop control.',
        updatedAt: nowIso,
      },
      needsApprovalRecord: false,
      blockedReason: 'Emergency Stop is currently active.',
    };
  }

  if (policy.requiresApproval) {
    return {
      nextTask: {
        ...task,
        status: 'awaiting_approval',
        progressPercent: 0,
        currentStage: 'Awaiting mandatory Owner approval',
        updatedAt: nowIso,
      },
      needsApprovalRecord: true,
      blockedReason: null,
    };
  }

  return {
    nextTask: {
      ...task,
      status: 'running',
      progressPercent: 15,
      currentStage: 'Initializing agent workspace & context...',
      attempts: task.attempts + 1,
      errorMessage: null,
      updatedAt: nowIso,
    },
    needsApprovalRecord: false,
    blockedReason: null,
  };
}

export function suggestAgentForAction(actionType: ActionType, goalText: string): AgentId {
  const lower = goalText.toLowerCase();
  if (actionType === 'database_migration' || actionType === 'database_deletion' || actionType === 'branch_code_change' || actionType === 'production_deploy') {
    return 'software-engineer';
  }
  if (actionType === 'test_execution' || actionType === 'code_analysis') {
    return /security|audit|test|lint|review/.test(lower) ? 'quality-auditor' : 'software-engineer';
  }
  if (actionType === 'payment_purchase' || /profit|revenue|expense|budget|cash|tax|ledger/.test(lower)) {
    return 'finance-assistant';
  }
  if (/deadline|timeline|milestone|sprint|roadmap/.test(lower)) {
    return 'project-manager';
  }
  if (/inventory|staff|pos|cafe|restaurant|operations|shift/.test(lower)) {
    return 'operations-manager';
  }
  if (/market|growth|strategy|competitor|customer/.test(lower)) {
    return 'business-analyst';
  }
  return 'chief-agent';
}
