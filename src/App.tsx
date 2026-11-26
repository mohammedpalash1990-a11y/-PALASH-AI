import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Database,
  Download,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  OctagonAlert,
  ShieldCheck,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { AgentsChatView } from './components/AgentsChatView';
import { ApprovalsSecurityView } from './components/ApprovalsSecurityView';
import { AuthGate } from './components/AuthGate';
import { BusinessFinanceView } from './components/BusinessFinanceView';
import { DatabaseConsoleView } from './components/DatabaseConsoleView';
import { EngineeringGitHubView } from './components/EngineeringGitHubView';
import { MonitoringAuditView } from './components/MonitoringAuditView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OverviewView } from './components/OverviewView';
import { ProjectsCenterView } from './components/ProjectsCenterView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { VoiceCommandController } from './components/VoiceCommandController';
import type {
  ActionType,
  AgentId,
  AgentItem,
  ApprovalItem,
  AuditLogItem,
  AuthUser,
  HealthStatus,
  MemoryItem,
  NavSection,
  OverviewResponse,
  PolicyRuleItem,
  ProjectItem,
  TaskItem,
} from './types';

const NAV_ITEMS: Array<{ id: NavSection; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Command Overview', shortLabel: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents & Queue', shortLabel: 'Agents', icon: Bot },
  { id: 'approvals', label: 'Approvals & Safety', shortLabel: 'Approvals', icon: ShieldCheck },
  { id: 'projects', label: 'Projects Center', shortLabel: 'Projects', icon: FolderKanban },
  { id: 'finance', label: 'Business & P&L', shortLabel: 'Finance', icon: TrendingUp },
  { id: 'github', label: 'GitHub Engineering', shortLabel: 'GitHub', icon: GitBranch },
  { id: 'database', label: 'Database Console', shortLabel: 'Database', icon: Database },
  { id: 'monitoring', label: 'Monitoring & Audit', shortLabel: 'Monitor', icon: Activity },
];

export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [authStatus, setAuthStatus] = useState<{
    loaded: boolean;
    needsSetup: boolean;
    envAdminConfigured: boolean;
    suggestedEmail: string;
  }>({
    loaded: false,
    needsSetup: true,
    envAdminConfigured: false,
    suggestedEmail: 'mohammedpalash1990@gmail.com',
  });

  // In-memory session token (never persisted to localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const [section, setSection] = useState<NavSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [policies, setPolicies] = useState<PolicyRuleItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const loadBoot = async () => {
      try {
        const [statusRes, healthRes] = await Promise.all([
          fetch('/api/auth/status'),
          fetch('/api/health'),
        ]);
        if (statusRes.ok) {
          const st = await statusRes.json();
          setAuthStatus({ loaded: true, ...st });
        } else {
          setAuthStatus((prev) => ({ ...prev, loaded: true }));
        }
        if (healthRes.ok) {
          setHealth(await healthRes.json());
        }
      } catch {
        setAuthStatus((prev) => ({ ...prev, loaded: true }));
      }
    };
    loadBoot();
  }, []);

  const refreshWorkspace = useCallback(async (activeToken: string) => {
    const headers = { Authorization: `Bearer ${activeToken}` };
    const [ovRes, agRes, tkRes, apRes, prRes, auRes, memRes, hlRes] = await Promise.all([
      fetch('/api/overview', { headers }),
      fetch('/api/agents', { headers }),
      fetch('/api/tasks', { headers }),
      fetch('/api/approvals', { headers }),
      fetch('/api/projects', { headers }),
      fetch('/api/audit-logs', { headers }),
      fetch('/api/memory', { headers }),
      fetch('/api/health'),
    ]);

    if (ovRes.status === 401) {
      setToken(null);
      setUser(null);
      return;
    }

    if (ovRes.ok) setOverview(await ovRes.json());
    if (agRes.ok) {
      const agData = await agRes.json();
      setAgents(agData.agents || []);
      setPolicies(agData.policies || []);
    }
    if (tkRes.ok) setTasks((await tkRes.json()).tasks || []);
    if (apRes.ok) setApprovals((await apRes.json()).approvals || []);
    if (prRes.ok) setProjects((await prRes.json()).projects || []);
    if (auRes.ok) setAuditLogs((await auRes.json()).logs || []);
    if (memRes.ok) setMemories((await memRes.json()).memories || []);
    if (hlRes.ok) setHealth(await hlRes.json());
  }, []);

  useEffect(() => {
    if (token) {
      refreshWorkspace(token);
    }
  }, [token, refreshWorkspace]);

  const handleAuthenticated = (newToken: string, authUser: AuthUser) => {
    setToken(newToken);
    setUser(authUser);
    setBanner(null);
  };

  const handleLogout = async () => {
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    setOverview(null);
    const statusRes = await fetch('/api/auth/status');
    if (statusRes.ok) {
      setAuthStatus({ loaded: true, ...(await statusRes.json()) });
    }
  };

  const handlePlanMission = async (objective: string, projectId: string) => {
    if (!token) return;
    setBusyAction('plan');
    setBanner(null);
    try {
      const res = await fetch('/api/missions/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ objective, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error || 'Chief Agent mission planning failed.' });
      } else {
        setBanner({
          kind: 'info',
          text: `Chief Agent created ${data.tasks.length} tasks (${data.approvals.length} queued for Owner approval).`,
        });
        await refreshWorkspace(token);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateTask = async (payload: {
    title: string;
    description: string;
    projectId: string;
    assignedAgentId: AgentId;
    actionType: ActionType;
  }) => {
    if (!token) return;
    setBusyAction('create-task');
    setBanner(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error || 'Failed to create task.' });
      } else {
        setBanner({
          kind: 'info',
          text: data.approval
            ? `Task "${payload.title}" queued and awaiting Owner approval.`
            : `Task "${payload.title}" queued for ${payload.assignedAgentId}.`,
        });
        await refreshWorkspace(token);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleExecuteTask = async (taskId: string) => {
    if (!token) return;
    setBusyAction(`exec-${taskId}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/execute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error || 'Task execution failed.' });
      } else {
        setBanner({ kind: 'info', text: `Completed "${data.task.title}".` });
      }
      await refreshWorkspace(token);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    if (!token) return;
    setBusyAction(`retry-${taskId}`);
    try {
      const res = await fetch(`/api/tasks/${taskId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error || 'Retry failed.' });
      } else {
        setBanner({ kind: 'info', text: `Re-queued "${data.task.title}".` });
        await refreshWorkspace(token);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecideApproval = async (
    approvalId: string,
    decision: 'approved' | 'rejected',
    note?: string
  ) => {
    if (!token) return;
    setBusyAction(`${decision === 'approved' ? 'approve' : 'reject'}-${approvalId}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error || 'Approval decision failed.' });
      } else {
        setBanner({
          kind: 'info',
          text: data.pushResult
            ? `Approved & pushed ${data.pushResult.filesPushed} file(s) to ${data.pushResult.owner}/${data.pushResult.repo}@${data.pushResult.branch} (${data.pushResult.commitSha.slice(0, 7)}).`
            : `Action ${decision}. Audit trail updated.`,
        });
        await refreshWorkspace(token);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleEmergencyStop = async (active: boolean, reason?: string) => {
    if (!token) return;
    setBusyAction('emergency-stop');
    try {
      const res = await fetch('/api/system/emergency-stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active, reason }),
      });
      if (res.ok) {
        setBanner({
          kind: active ? 'error' : 'info',
          text: active
            ? 'Emergency Stop activated: all autonomous workers halted.'
            : 'Operations resumed: agents returned to ready state.',
        });
        await refreshWorkspace(token);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleQueuePRProposal = async (payload: {
    projectId: string;
    branch: string;
    title: string;
    summary: string;
  }) => {
    if (!token) return;
    setBusyAction('propose-pr');
    try {
      const res = await fetch('/api/github/propose-pr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error || 'Failed to queue PR approval.' });
      } else {
        setBanner({
          kind: 'info',
          text: `Branch change "${payload.title}" queued in Approvals.`,
        });
        await refreshWorkspace(token);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadZip = async () => {
    try {
      let res = await fetch('/api/download/project-zip');
      if (!res.ok) {
        res = await fetch('/palash-ai-project.zip');
      }
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'palash-ai-project.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } catch {
          // cleanup
        }
      }, 1500);
    } catch {
      setBanner({ kind: 'error', text: 'Failed to download project ZIP. Please try again.' });
    }
  };

  const handleCreateProject = async (payload: {
    name: string;
    repoOwner: string;
    repoName: string;
    category: 'platform' | 'pos' | 'marketplace' | 'saas';
    deadline: string;
    description: string;
  }) => {
    if (!token) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setBanner({ kind: 'error', text: data.error || 'Project creation failed.' });
    } else {
      setBanner({ kind: 'info', text: `Registered project "${data.project.name}".` });
      await refreshWorkspace(token);
    }
  };

  const handleUpdateProject = async (
    id: string,
    patch: { progress?: number; status?: ProjectItem['status'] }
  ) => {
    if (!token) return;
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await refreshWorkspace(token);
    }
  };

  if (!authStatus.loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        Initializing PALASH AI runtime...
      </div>
    );
  }

  if (!token || !user) {
    return (
      <>
        <AuthGate
          needsSetup={authStatus.needsSetup}
          envAdminConfigured={authStatus.envAdminConfigured}
          suggestedEmail={authStatus.suggestedEmail}
          health={health}
          darkMode={darkMode}
          onToggleTheme={() => setDarkMode((d) => !d)}
          onAuthenticated={handleAuthenticated}
        />
        <OfflineIndicator />
      </>
    );
  }

  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;
  const currentNavMeta = NAV_ITEMS.find((n) => n.id === section) || NAV_ITEMS[0];
  const mobilePrimaryTabs = NAV_ITEMS.slice(0, 5);

  const navigateToSection = (next: NavSection) => {
    setSection(next);
    setBanner(null);
    setMobileMenuOpen(false);
  };

  const handleTriggerBackup = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/system/backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ kind: 'info', text: data.backup?.content || 'Verified backup snapshot completed.' });
        await refreshWorkspace(token);
      } else {
        setBanner({ kind: 'error', text: data.error || 'Backup creation failed.' });
      }
    } catch {
      setBanner({ kind: 'error', text: 'Failed to trigger backup snapshot.' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white dark:lg:border-slate-800 dark:lg:bg-slate-900">
        <div className="flex h-16 items-center border-b border-slate-200 px-6 dark:border-slate-800">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            PALASH AI
          </span>
        </div>

        <nav aria-label="Workspace Navigation" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToSection(item.id)}
                className={`flex w-full min-h-[42px] items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-teal-600/10 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'approvals' && pendingApprovalsCount > 0 && (
                  <span className="font-mono text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 space-y-3 dark:border-slate-800">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 dark:text-white truncate">{user.name}</p>
            <p className="text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex w-full min-h-[38px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        {/* Top Bar Contract: Breadcrumb / Brand left, concise controls right */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs sm:h-16 sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 text-slate-700 lg:hidden dark:border-slate-700 dark:text-slate-200"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="truncate font-display text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
              {currentNavMeta.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <VoiceCommandController
              onNavigate={navigateToSection}
              onEmergencyStop={handleToggleEmergencyStop}
              isEmergencyStopActive={Boolean(overview?.emergencyStop)}
              onTriggerBackup={handleTriggerBackup}
              onToggleTheme={() => setDarkMode((d) => !d)}
              onSignOut={handleLogout}
              pendingApprovalsCount={pendingApprovalsCount}
            />

            <PWAInstallButton />

            <button
              type="button"
              onClick={handleDownloadZip}
              title="Download full PALASH AI project source code as ZIP"
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <span className="hidden sm:inline">Download ZIP</span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              aria-label={overview?.emergencyStop ? 'Resume agent operations' : 'Activate emergency stop'}
              onClick={() =>
                handleToggleEmergencyStop(
                  !overview?.emergencyStop,
                  overview?.emergencyStop ? undefined : 'Header Quick Stop'
                )
              }
              disabled={busyAction === 'emergency-stop'}
              className={`inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors ${
                overview?.emergencyStop
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
              }`}
            >
              <OctagonAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">
                {overview?.emergencyStop ? 'Resume Agents' : 'Emergency Stop'}
              </span>
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">
          {banner && (
            <div
              role={banner.kind === 'error' ? 'alert' : 'status'}
              className={`mb-6 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-medium ${
                banner.kind === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-200'
              }`}
            >
              <span>{banner.text}</span>
              <button
                type="button"
                onClick={() => setBanner(null)}
                aria-label="Dismiss message"
                className="p-1 hover:opacity-75"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {!overview ? (
            <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading PALASH AI workspace...
            </div>
          ) : (
            <>
              {section === 'overview' && (
                <OverviewView
                  overview={overview}
                  agents={agents}
                  onNavigate={setSection}
                  onPlanMission={handlePlanMission}
                  onDecideApproval={handleDecideApproval}
                  onExecuteTask={handleExecuteTask}
                  busyAction={busyAction}
                />
              )}

              {section === 'agents' && (
                <AgentsChatView
                  token={token}
                  agents={agents}
                  projects={projects}
                  tasks={tasks}
                  memories={memories}
                  emergencyStop={overview.emergencyStop}
                  onCreateTask={handleCreateTask}
                  onExecuteTask={handleExecuteTask}
                  onRetryTask={handleRetryTask}
                  busyAction={busyAction}
                />
              )}

              {section === 'github' && (
                <EngineeringGitHubView
                  token={token}
                  projects={projects}
                  onQueuePRProposal={handleQueuePRProposal}
                  onRefreshWorkspace={() => refreshWorkspace(token)}
                  onNavigateApprovals={() => setSection('approvals')}
                  busyAction={busyAction}
                />
              )}

              {section === 'database' && (
                <DatabaseConsoleView
                  token={token}
                  projects={projects}
                  onRefreshAll={() => refreshWorkspace(token)}
                />
              )}

              {section === 'projects' && (
                <ProjectsCenterView
                  projects={projects}
                  onCreateProject={handleCreateProject}
                  onUpdateProject={handleUpdateProject}
                />
              )}

              {section === 'finance' && (
                <BusinessFinanceView
                  token={token}
                  projects={projects}
                  onRefreshOverview={() => refreshWorkspace(token)}
                />
              )}

              {section === 'approvals' && (
                <ApprovalsSecurityView
                  approvals={approvals}
                  policies={policies}
                  emergencyStop={overview.emergencyStop}
                  emergencyStopReason={overview.emergencyStopReason}
                  onDecideApproval={handleDecideApproval}
                  onToggleEmergencyStop={handleToggleEmergencyStop}
                  busyAction={busyAction}
                />
              )}

              {section === 'monitoring' && (
                <MonitoringAuditView
                  token={token}
                  health={health}
                  auditLogs={auditLogs}
                  onRefreshAll={() => refreshWorkspace(token)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation (compact <=15% height cap) */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 grid h-16 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-md lg:hidden dark:border-slate-800 dark:bg-slate-900/95"
      >
        {mobilePrimaryTabs.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToSection(item.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                active
                  ? 'text-teal-700 dark:text-teal-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="mt-1 text-[10px] font-medium tracking-tight">
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Full Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/60 backdrop-blur-xs lg:hidden">
          <div className="flex w-72 flex-col bg-white p-5 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <span className="font-display text-base font-bold text-slate-900 dark:text-white">
                PALASH AI
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="mt-4 flex-1 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateToSection(item.id)}
                    className={`flex w-full min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                      active
                        ? 'bg-teal-600/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                {user.email}
              </p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-3 flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
