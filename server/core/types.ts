export type AgentId =
  | 'chief-agent'
  | 'software-engineer'
  | 'project-manager'
  | 'business-analyst'
  | 'finance-assistant'
  | 'operations-manager'
  | 'quality-auditor';

export type ActionType =
  | 'research'
  | 'planning'
  | 'code_analysis'
  | 'test_execution'
  | 'branch_code_change'
  | 'production_deploy'
  | 'database_migration'
  | 'database_deletion'
  | 'payment_purchase'
  | 'external_message'
  | 'social_publish';

export type ApprovalRequirement =
  | 'none'
  | 'auto_sandbox'
  | 'restricted_branch'
  | 'mandatory';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'auditor';
  passwordHash: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  category: 'platform' | 'pos' | 'marketplace' | 'saas';
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  permissionScope: 'full-control' | 'branch-only-with-approval' | 'read-analyze';
  dbIsolationLabel: string;
  deploymentPolicy: 'mandatory-owner-approval' | 'staging-auto-prod-approval';
  status: 'active' | 'maintenance' | 'attention';
  progress: number;
  deadline: string;
  description: string;
  updatedAt: string;
}

export interface AgentRecord {
  id: AgentId;
  name: string;
  title: string;
  specialty: string;
  model: string;
  status: 'ready' | 'executing' | 'halted';
  completedTasks: number;
  failedTasks: number;
  avgLatencyMs: number;
  capabilities: string[];
  lastActiveAt: string | null;
}

export interface TaskRecord {
  id: string;
  missionId: string;
  projectId: string;
  assignedAgentId: AgentId;
  title: string;
  description: string;
  actionType: ActionType;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approvalRequirement: ApprovalRequirement;
  status: TaskStatus;
  progressPercent: number;
  currentStage: string | null;
  attempts: number;
  maxAttempts: number;
  outputReport: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubPushApprovalMeta {
  owner: string;
  repo: string;
  targetBranch: string;
  baseBranch: string;
  commitMessage: string;
  filePaths: string[];
  createPullRequest?: boolean;
  prTitle?: string;
  executedCommitSha?: string | null;
  executedCommitUrl?: string | null;
  executedPrUrl?: string | null;
  executedPrNumber?: number | null;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  projectId: string;
  requestedByAgentId: AgentId;
  actionType: ActionType;
  riskLevel: 'medium' | 'high' | 'critical';
  title: string;
  summary: string;
  payloadPreview: string;
  githubPushMeta?: GitHubPushApprovalMeta | null;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AuditLogRecord {
  id: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'blocked' | 'pending' | 'error';
  ip: string;
  details: string;
  timestamp: string;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  agentId: AgentId;
  category: 'context' | 'decision' | 'backup' | 'migration' | 'report';
  title: string;
  content: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  projectId: string;
  type: 'revenue' | 'expense' | 'staff_cost' | 'inventory';
  category: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  createdAt: string;
}

export interface BudgetTarget {
  projectId: string;
  monthlyBudget: number;
  revenueTarget: number;
  staffCostCap: number;
}

export interface SystemState {
  emergencyStop: boolean;
  emergencyStopReason: string | null;
  emergencyStoppedAt: string | null;
  dbInitializedAt: string;
  lastBackupAt: string | null;
  apiMetrics: {
    totalRequests: number;
    errorCount: number;
    avgLatencyMs: number;
    lastHealthCheckAt: string | null;
  };
}

export interface PalashDatabase {
  users: UserRecord[];
  projects: ProjectRecord[];
  agents: AgentRecord[];
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  audit_logs: AuditLogRecord[];
  agent_memory: MemoryRecord[];
  ledger_entries: LedgerEntry[];
  budget_targets: BudgetTarget[];
  system: SystemState;
}
