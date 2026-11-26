import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, Download, MinusCircle, RefreshCw } from 'lucide-react';
import type { AuditLogItem, HealthStatus } from '../types';

interface MonitoringMetrics {
  uptimeSec: number;
  memoryMb: number;
  apiMetrics: {
    totalRequests: number;
    errorCount: number;
    avgLatencyMs: number;
    lastHealthCheckAt: string | null;
  };
  lastBackupAt: string | null;
  emergencyStop: boolean;
  postgres: HealthStatus['database']['postgres'];
  agentStats: Array<{
    id: string;
    name: string;
    status: string;
    completedTasks: number;
    failedTasks: number;
    avgLatencyMs: number;
  }>;
}

interface BackupItem { id: string; checksum: string; integrity?: string; source: string; createdAt: string; storage: string; }

interface ReadinessCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface ReadinessPayload {
  checks: ReadinessCheck[];
  coreReady: boolean;
  timestamp: string;
}

const OPTIONAL_CHECK_IDS = new Set(['neon-postgres', 'github-token', 'backup-verified']);

interface MonitoringAuditViewProps {
  token: string;
  health: HealthStatus | null;
  auditLogs: AuditLogItem[];
  onRefreshAll: () => Promise<void>;
}

export const MonitoringAuditView: React.FC<MonitoringAuditViewProps> = ({
  token,
  health,
  auditLogs,
  onRefreshAll,
}) => {
  const [metrics, setMetrics] = useState<MonitoringMetrics | null>(null);
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [search, setSearch] = useState('');
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupBusy, setBackupBusy] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);

  const loadMetrics = async () => {
    const [metricsRes, readinessRes, backupsRes] = await Promise.all([
      fetch('/api/monitoring/metrics', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch('/api/system/readiness', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch('/api/system/backups', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (metricsRes.ok) {
      setMetrics(await metricsRes.json());
    }
    if (readinessRes.ok) {
      setReadiness(await readinessRes.json());
    }
    if (backupsRes.ok) {
      const data = await backupsRes.json();
      setBackups(Array.isArray(data.backups) ? data.backups : []);
      setBackupError(null);
    } else {
      setBackupError('Backup list could not be loaded.');
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [token]);

  const handleCreateBackup = async () => {
    setBackupBusy('create');
    setBackupError(null);
    setBackupFeedback(null);
    try {
      const res = await fetch('/api/system/backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Snapshot creation failed.');
      await loadMetrics();
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Snapshot creation failed.');
    } finally {
      setBackupBusy(null);
    }
  };

  const handleDownloadBackup = async (id: string) => {
    setBackupBusy(id);
    setBackupError(null);
    setBackupFeedback(null);
    try {
      const res = await fetch(`/api/system/backups/${encodeURIComponent(id.replace(/^bkp-/, ''))}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.backup?.snapshot) throw new Error(data.error || 'Snapshot export failed.');
      if (data.backup.integrity !== 'verified') throw new Error('Snapshot checksum could not be verified. Export blocked.');
      const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `palash-ai-backup-${id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Snapshot export failed.');
    } finally {
      setBackupBusy(null);
    }
  };

  const handleRestoreBackup = async (id: string) => {
    if (backupBusy !== null) return;
    if (!window.confirm(`Request restore of ${id}? This will require Owner approval and will create a safety snapshot before applying the backup.`)) return;
    setBackupBusy(`restore-${id}`);
    setBackupError(null);
    setBackupFeedback(null);
    try {
      const numericId = id.replace(/^bkp-/, '');
      const res = await fetch(`/api/system/backups/${encodeURIComponent(numericId)}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore approval request failed.');
      setBackupFeedback(`Restore request ${data.approval?.id || ''} created. Open Approvals and approve it to apply the verified snapshot.`);
      await Promise.all([loadMetrics(), onRefreshAll()]);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Restore approval request failed.');
    } finally {
      setBackupBusy(null);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadMetrics(), onRefreshAll()]);
  };

  const filteredLogs = auditLogs.filter(
    (l) =>
      !search.trim() ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.actor.toLowerCase().includes(search.toLowerCase()) ||
      l.details.toLowerCase().includes(search.toLowerCase())
  );

  const passedCount = readiness?.checks.filter((c) => c.passed).length ?? 0;
  const totalChecks = readiness?.checks.length ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            System Reliability, Telemetry &amp; Immutable Audit Logs
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live runtime health, API latency, process footprint, Phase 10 readiness audit, and security audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {/* Live Health Metrics */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Runtime Status</p>
          <p
            className={`mt-2 font-display text-xl font-bold capitalize ${
              health?.status === 'halted'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {health?.status || 'healthy'}
          </p>
          <p className="mt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            Uptime {metrics ? `${metrics.uptimeSec}s` : '—'} · {metrics ? `${metrics.memoryMb} MB RSS` : ''}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">API Latency &amp; Volume</p>
          <p className="mt-2 font-display text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {metrics ? `${metrics.apiMetrics.avgLatencyMs} ms` : '—'}
          </p>
          <p className="mt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {metrics ? `${metrics.apiMetrics.totalRequests} requests · ${metrics.apiMetrics.errorCount} 5xx` : ''}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">AI &amp; GitHub Keys</p>
          <p className="mt-2 font-display text-xl font-bold text-slate-900 dark:text-white">
            {health?.geminiConfigured ? 'Gemini Ready' : 'Gemini Unset'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            GitHub Token: {health?.githubTokenConfigured ? 'Configured' : 'Public API only'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Last Verified Backup</p>
          <p className="mt-2 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
            {metrics?.lastBackupAt ? new Date(metrics.lastBackupAt).toLocaleTimeString() : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics?.lastBackupAt ? new Date(metrics.lastBackupAt).toLocaleDateString() : 'No snapshot yet'}
          </p>
        </div>
      </section>

      {/* Phase 10 Production Readiness Audit */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Phase 10 Production Readiness Audit
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live deployment checklist covering authentication, schema, agent governance, AI provider, and external bridges.
            </p>
          </div>
          {readiness && (
            <div className="text-xs font-semibold tabular-nums">
              <span
                className={
                  readiness.coreReady
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }
              >
                {readiness.coreReady ? 'Core Systems Ready' : 'Core Attention Needed'}
              </span>
              <span className="ml-2 font-mono text-slate-500 dark:text-slate-400">
                · {passedCount}/{totalChecks} checks passed
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(readiness?.checks || []).map((check) => {
            const isOptional = !check.passed && OPTIONAL_CHECK_IDS.has(check.id);
            const statusText = check.passed
              ? 'Passed'
              : isOptional
                ? 'Optional'
                : 'Attention';
            return (
              <div
                key={check.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {check.label}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {check.detail}
                  </p>
                </div>
                <div
                  className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${
                    check.passed
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : isOptional
                        ? 'text-slate-600 dark:text-slate-300'
                        : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {check.passed ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : isOptional ? (
                    <MinusCircle className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{statusText}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Neon Backup Archive */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">Neon Backup Archive</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Stored PostgreSQL snapshots. Export and restore are available only for checksum-verified snapshots; restore requires Owner approval and creates a safety snapshot first.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{backups.length} saved snapshot(s)</span>
            <button type="button" onClick={handleCreateBackup} disabled={backupBusy !== null} className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              {backupBusy === 'create' ? 'Creating…' : 'Create Snapshot'}
            </button>
          </div>
        </div>
        {backupError && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">{backupError}</p>}
        {backupFeedback && <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{backupFeedback}</p>}
        <div className="mt-4 space-y-2">
          {backups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">No database snapshots found.</p>
          ) : backups.map((backup) => (
            <div key={backup.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">{backup.id} <span className="font-normal text-slate-500">· {backup.source}</span></p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{new Date(backup.createdAt).toLocaleString()} · {backup.storage}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-slate-400">Checksum: {backup.checksum}</p>
                <p className={"mt-1 text-[10px] font-semibold " + (backup.integrity === "verified" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>Integrity: {backup.integrity === "verified" ? "Verified" : "Not verified"}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button type="button" onClick={() => handleDownloadBackup(backup.id)} disabled={backupBusy !== null} className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {backupBusy === backup.id ? 'Preparing…' : 'Export JSON'}
                </button>
                <button type="button" onClick={() => handleRestoreBackup(backup.id)} disabled={backup.integrity !== 'verified' || backupBusy !== null} className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30">
                  {backupBusy === `restore-${backup.id}` ? 'Requesting…' : 'Request Restore'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Audit Logs */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Security &amp; Execution Audit Trail ({filteredLogs.length})
          </h3>
          <input
            type="search"
            aria-label="Filter audit logs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter actor, action, or details..."
            className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs sm:w-64 dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Outcome</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLogs.slice(0, 50).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {log.actor}
                  </td>
                  <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-white whitespace-nowrap">
                    {log.action}
                  </td>
                  <td
                    className={`px-4 py-2.5 font-semibold uppercase whitespace-nowrap ${
                      log.outcome === 'success'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : log.outcome === 'blocked' || log.outcome === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {log.outcome}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                    {log.details}
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
