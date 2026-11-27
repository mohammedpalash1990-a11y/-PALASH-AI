import React, { useState } from 'react';
import { Mic, MicOff, Play, Check, X, ArrowUpRight, AlertTriangle, Bot, FolderKanban, GitBranch, ShieldCheck } from 'lucide-react';
import type { AgentItem, NavSection, OverviewResponse } from '../types';

interface OverviewViewProps {
  overview: OverviewResponse;
  agents: AgentItem[];
  onNavigate: (section: NavSection) => void;
  onPlanMission: (objective: string, projectId: string) => Promise<void>;
  onDecideApproval: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>;
  onExecuteTask: (taskId: string) => Promise<void>;
  busyAction: string | null;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  overview,
  agents,
  onNavigate,
  onPlanMission,
  onDecideApproval,
  onExecuteTask,
  busyAction,
}) => {
  const [objective, setObjective] = useState('');
  const [projectId, setProjectId] = useState(overview.projects[0]?.id || 'palash-ai');
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [showAllAgents, setShowAllAgents] = useState(false);

  const handlePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim()) return;
    await onPlanMission(objective.trim(), projectId);
    setObjective('');
  };

  const toggleVoiceInput = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceNote('Voice dictation is unavailable in this browser.');
      return;
    }

    if (listening) {
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition() as {
      lang: string;
      interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
    };
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    setListening(true);
    setVoiceNote(null);

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        setObjective((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    recognition.onerror = () => {
      setVoiceNote('Microphone capture failed or permission was denied.');
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.start();
  };

  const pendingApprovals = overview.recentApprovals.filter((a) => a.status === 'pending');
  const visibleAgents = showAllAgents ? agents : agents.slice(0, 4);

  return (
    <div className="space-y-5 sm:space-y-6">
      {overview.emergencyStop && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">Emergency Stop Active</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                All autonomous agent execution and mission planning are halted ({overview.emergencyStopReason || 'Owner override'}).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('approvals')}
            className="min-h-[40px] whitespace-nowrap shrink-0 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/40 dark:text-red-100"
          >
            Manage Safety Gate
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <section aria-label="Workspace summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Projects</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {overview.projectsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Connected workspaces
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Open tasks</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {overview.tasks.queued + overview.tasks.running}
          </p>
          <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {overview.tasks.completed} completed · {overview.tasks.failed} failed
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Needs your review</p>
          <p
            className={`mt-2 font-display text-2xl font-bold tabular-nums ${
              overview.pendingApprovalsCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {overview.pendingApprovalsCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Waiting for approval
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Net profit</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            ${overview.financeSummary.netProfit.toLocaleString()}
          </p>
          <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {overview.financeSummary.profitMarginPct}% margin across ventures
          </p>
        </div>
      </section>

      <section aria-label="Quick access" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { id: 'agents' as const, label: 'Talk to AI Assistant', detail: 'Chat and create tasks', icon: Bot },
          { id: 'projects' as const, label: 'Manage projects', detail: 'View all workspaces', icon: FolderKanban },
          { id: 'github' as const, label: 'Open GitHub tools', detail: 'Inspect code and branches', icon: GitBranch },
          { id: 'approvals' as const, label: 'Review approvals', detail: pendingApprovals.length ? `${pendingApprovals.length} waiting for you` : 'No requests waiting', icon: ShieldCheck },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className="group flex min-h-[82px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800 dark:hover:bg-teal-950/20 sm:p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 group-hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0"><span className="block text-xs font-bold text-slate-900 dark:text-white">{item.label}</span><span className="mt-1 block truncate text-[10px] text-slate-500 dark:text-slate-400">{item.detail}</span></span>
              <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 group-hover:text-teal-700 dark:text-slate-600 dark:group-hover:text-teal-300" aria-hidden="true" />
            </button>
          );
        })}
      </section>

      {/* Chief Agent Quick Mission Orchestrator */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              What would you like PALASH AI to do?
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Write a request in your own words. PALASH AI will plan the work and show you anything that needs approval.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('agents')}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 whitespace-nowrap shrink-0"
          >
            <span>Open AI Assistant</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handlePlanSubmit} className="mt-4 flex flex-col gap-3 lg:flex-row">
          <label htmlFor="overview-project-select" className="sr-only">
            Target Project
          </label>
          <select
            id="overview-project-select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 lg:w-60"
          >
            {overview.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="relative flex flex-1 items-center">
            <label htmlFor="overview-mission-input" className="sr-only">
              Mission Objective
            </label>
            <input
              id="overview-mission-input"
              type="text"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Example: Check my projects, find problems, and tell me what to fix first"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-12 text-sm text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={toggleVoiceInput}
              aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
              className={`absolute right-1.5 inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                listening
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={busyAction === 'plan' || !objective.trim() || overview.emergencyStop}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
          >
            {busyAction === 'plan' ? 'Creating plan...' : 'Create plan'}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Try:</span>
          {[
            'Review my projects and show the most urgent issue',
            'Check my GitHub repository for bugs',
            'Prepare a weekly progress report',
          ].map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setObjective(suggestion)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-teal-800 dark:hover:bg-teal-950/40 dark:hover:text-teal-200">{suggestion}</button>
          ))}
        </div>
        {voiceNote && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{voiceNote}</p>
        )}
      </section>

      {/* Two-Column Split: Pending Approvals + Recent Tasks */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Approvals Queue
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              View Policy Matrix
            </button>
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No pending approvals
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                High-risk actions (deployments, migrations, payments) pause here for your review.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {pendingApprovals.slice(0, 3).map((item) => (
                <li key={item.id} className="py-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {item.projectId} · {item.requestedByAgentId} · Risk: {item.riskLevel}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {item.summary}
                  </p>
                  <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                    {item.payloadPreview}
                  </pre>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busyAction === `approve-${item.id}`}
                      onClick={() => onDecideApproval(item.id, 'approved')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === `reject-${item.id}`}
                      onClick={() => onDecideApproval(item.id, 'rejected')}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Reject</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Recent Task Execution Queue
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('agents')}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Manage All Tasks
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {overview.recentTasks.slice(0, 6).map((task) => (
              <div
                key={task.id}
                className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {task.assignedAgentId} · {task.projectId} · {task.actionType} ·{' '}
                    <span
                      className={
                        task.status === 'completed'
                          ? 'font-medium text-emerald-700 dark:text-emerald-400'
                          : task.status === 'awaiting_approval'
                            ? 'font-medium text-amber-700 dark:text-amber-400'
                            : task.status === 'failed'
                              ? 'font-medium text-red-600 dark:text-red-400'
                              : 'font-medium text-slate-700 dark:text-slate-300'
                      }
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                  </p>
                </div>

                {task.status === 'queued' && (
                  <button
                    type="button"
                    disabled={busyAction === `exec-${task.id}` || overview.emergencyStop}
                    onClick={() => onExecuteTask(task.id)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{busyAction === `exec-${task.id}` ? 'Running...' : 'Run Agent'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 7-Agent Roster */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Your AI team
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Specialists are ready to help with different types of work.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visibleAgents.map((ag) => (
            <div
              key={ag.id}
              className="flex flex-col justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    {ag.name}
                  </h3>
                  <span
                    className={`text-xs font-medium ${
                      ag.status === 'halted'
                        ? 'text-red-600 dark:text-red-400'
                        : ag.status === 'executing'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {ag.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-medium text-teal-700 dark:text-teal-400">
                  {ag.title}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {ag.specialty}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 font-mono text-[11px] tabular-nums text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span>{ag.completedTasks} done</span>
                <span>{ag.avgLatencyMs}ms avg</span>
              </div>
            </div>
          ))}
        </div>
        {agents.length > 4 && (
          <button type="button" onClick={() => setShowAllAgents((value) => !value)} className="mt-4 min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800">
            {showAllAgents ? 'Show fewer agents' : `Show all ${agents.length} agents`}
          </button>
        )}
      </section>
    </div>
  );
};
