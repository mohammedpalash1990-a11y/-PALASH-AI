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
  | 'social_media_publish';

export type NavSection =
  | 'overview'
  | 'agents'
  | 'github'
  | 'database'
  | 'projects'
  | 'finance'
  | 'approvals'
  | 'monitoring';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'auditor';
}

export interface HealthStatus {
  status: 'healthy' | 'halted';
  service: string;
  timestamp: string;
  database: {
    localStoreInitialized: boolean;
    tablesCount: number;
    postgres: {
      configured: boolean;
      connected: boolean;
      database: string | null;
      version: string | null;
      latencyMs: number | null;
      error: string | null;
    };
  };
  agentsCount: number;
  ownerAccountReady: boolean;
  geminiConfigured: boolean;
  githubTokenConfigured: boolean;
  emergencyStop: boolean;
}

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  category: 'platform' | 'pos' | 'marketplace' | 'saas';
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  permissionScope: string;
  dbIsolationLabel: string;
  deploymentPolicy: string;
  status: 'active' | 'maintenance' | 'attention';
  progress: number;
  deadline: string;
  description: string;
  updatedAt: string;
}

export interface AgentItem {
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

export interface TaskItem {
  id: string;
  missionId: string;
  projectId: string;
  assignedAgentId: AgentId;
  title: string;
  description: string;
  actionType: ActionType;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approvalRequirement: string;
  status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
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

export interface ApprovalItem {
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

export interface PolicyRuleItem {
  actionType: ActionType;
  label: string;
  requirement: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresHumanApproval: boolean;
  description: string;
}

export interface AuditLogItem {
  id: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'blocked' | 'pending' | 'error';
  ip: string;
  details: string;
  timestamp: string;
}

export interface MemoryItem {
  id: string;
  projectId: string;
  agentId: AgentId;
  category: 'context' | 'decision' | 'backup' | 'migration' | 'report';
  title: string;
  content: string;
  createdAt: string;
}

export interface LedgerEntryItem {
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

export interface FinanceSummary {
  totalRevenue: number;
  totalExpenses: number;
  operatingExpenses: number;
  staffCosts: number;
  inventorySpend: number;
  netProfit: number;
  profitMarginPct: number;
  staffCostRatioPct: number;
  budgetUtilizationPct: number;
  monthlyBudget: number;
  revenueTarget: number;
  revenueAttainmentPct: number;
  cashFlowProjection30d: number;
  categoryBreakdown: Array<{ category: string; amount: number; type: string }>;
}

export interface OverviewResponse {
  projectsCount: number;
  agentsCount: number;
  tasks: {
    total: number;
    queued: number;
    running: number;
    awaitingApproval: number;
    completed: number;
    failed: number;
  };
  pendingApprovalsCount: number;
  emergencyStop: boolean;
  emergencyStopReason: string | null;
  financeSummary: FinanceSummary;
  recentTasks: TaskItem[];
  recentApprovals: ApprovalItem[];
  recentAudit: AuditLogItem[];
  projects: ProjectItem[];
}
