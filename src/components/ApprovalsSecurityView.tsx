import React, { useState } from 'react';
import { Check, X, ShieldAlert, OctagonAlert, Play } from 'lucide-react';
import type { ApprovalItem, PolicyRuleItem } from '../types';

interface ApprovalsSecurityViewProps {
  approvals: ApprovalItem[];
  policies: PolicyRuleItem[];
  emergencyStop: boolean;
  emergencyStopReason: string | null;
  onDecideApproval: (approvalId: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
  onToggleEmergencyStop: (active: boolean, reason?: string) => Promise<void>;
  busyAction: string | null;
}

export const ApprovalsSecurityView: React.FC<ApprovalsSecurityViewProps> = ({
  approvals,
  policies,
  emergencyStop,
  emergencyStopReason,
  onDecideApproval,
  onToggleEmergencyStop,
  busyAction,
}) => {
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [stopReason, setStopReason] = useState('Manual safety halt by Owner');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const filtered =
    filterStatus === 'all' ? approvals : approvals.filter((a) => a.status === filterStatus);

  return (
    <div className="space-y-8">
      {/* Emergency Stop Control */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldAlert
              className={`h-5 w-5 ${
                emergencyStop ? 'text-red-600 dark:text-red-400' : 'text-teal-600 dark:text-teal-400'
              }`}
              aria-hidden="true"
            />
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Emergency Stop &amp; Autonomous Boundary Control
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {emergencyStop
              ? `System is currently HALTED (${emergencyStopReason || 'Owner override'}). All running tasks were stopped.`
              : 'System is operating within policy boundaries. Trigger Emergency Stop to freeze all agent workers immediately.'}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {!emergencyStop && (
            <>
              <label htmlFor="stop-reason" className="sr-only">
                Emergency stop reason
              </label>
              <input
                id="stop-reason"
                type="text"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                placeholder="Reason for halt..."
                className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </>
          )}
          {emergencyStop ? (
            <button
              type="button"
              disabled={busyAction === 'emergency-stop'}
              onClick={() => onToggleEmergencyStop(false)}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>Resume Operations</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busyAction === 'emergency-stop'}
              onClick={() => onToggleEmergencyStop(true, stopReason)}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <OctagonAlert className="h-4 w-4" aria-hidden="true" />
              <span>Activate Emergency Stop</span>
            </button>
          )}
        </div>
      </section>

      {/* Approval Requests Queue */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Human Approval Requests
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Production deployments, schema migrations, branch merges, payments, and external messages require Owner approval.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterStatus(st)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize ${
                  filterStatus === st
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No approval records in this view.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((item) => (
              <li key={item.id} className="py-5 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {item.projectId} · {item.requestedByAgentId} · {item.actionType} · Risk: {item.riskLevel} ·{' '}
                      <span className="font-mono">{new Date(item.createdAt).toLocaleString()}</span>
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold uppercase ${
                      item.status === 'approved'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : item.status === 'rejected'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                <p className="text-xs text-slate-700 dark:text-slate-300">{item.summary}</p>
                <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {item.payloadPreview}
                </pre>

                {item.status === 'pending' ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor={`note-${item.id}`} className="sr-only">
                      Audit note for {item.title}
                    </label>
                    <input
                      id={`note-${item.id}`}
                      type="text"
                      value={decisionNotes[item.id] || ''}
                      onChange={(e) =>
                        setDecisionNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder="Optional audit note..."
                      className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyAction === `approve-${item.id}`}
                        onClick={() =>
                          onDecideApproval(item.id, 'approved', decisionNotes[item.id])
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Approve Action</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction === `reject-${item.id}`}
                        onClick={() =>
                          onDecideApproval(item.id, 'rejected', decisionNotes[item.id])
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <p>
                      Decided by {item.decidedBy || 'Owner'} on{' '}
                      {item.decidedAt ? new Date(item.decidedAt).toLocaleString() : '—'}
                      {item.decisionNote ? ` · Note: ${item.decisionNote}` : ''}
                    </p>
                    {item.githubPushMeta?.executedCommitUrl && (
                      <p className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                        <a
                          href={item.githubPushMeta.executedCommitUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800 dark:text-teal-400"
                        >
                          Commit {item.githubPushMeta.executedCommitSha?.slice(0, 7)} on GitHub
                        </a>
                        {item.githubPushMeta.executedPrUrl && (
                          <a
                            href={item.githubPushMeta.executedPrUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-800 dark:text-teal-400"
                          >
                            PR #{item.githubPushMeta.executedPrNumber}
                          </a>
                        )}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Phase 5 Approval Policy Matrix Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Mandatory Approval &amp; Risk Policy Matrix
        </h3>
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Action Category</th>
                <th className="px-4 py-3 font-semibold">Risk Tier</th>
                <th className="px-4 py-3 font-semibold">Approval Requirement</th>
                <th className="px-4 py-3 font-semibold">Enforcement Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {policies.map((rule) => (
                <tr key={rule.actionType}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                    {rule.label}
                  </td>
                  <td className="px-4 py-3 uppercase font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {rule.riskLevel}
                  </td>
                  <td
                    className={`px-4 py-3 font-semibold whitespace-nowrap ${
                      rule.requiresHumanApproval
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {rule.requiresHumanApproval ? 'Human Approval Required' : 'Autonomous Allowed'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {rule.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
