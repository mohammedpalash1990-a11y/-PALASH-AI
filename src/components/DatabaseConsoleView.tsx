import React, { useEffect, useState } from 'react';
import { Database, Play, ShieldAlert, HardDriveDownload } from 'lucide-react';
import type { ProjectItem } from '../types';

interface TableInfo {
  table: string;
  rows: number;
  columns: string[];
}

interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionMs: number;
  classification: string;
}

interface DatabaseConsoleViewProps {
  token: string;
  projects: ProjectItem[];
  onRefreshAll: () => Promise<void>;
}

export const DatabaseConsoleView: React.FC<DatabaseConsoleViewProps> = ({
  token,
  projects,
  onRefreshAll,
}) => {
  const [mode, setMode] = useState<string>('local-relational-store');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [pgConnected, setPgConnected] = useState(false);
  const [pgDbName, setPgDbName] = useState<string | null>(null);

  const [sql, setSql] = useState('SELECT * FROM agents LIMIT 20;');
  const [target, setTarget] = useState<'local' | 'postgres'>('local');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [runningQuery, setRunningQuery] = useState(false);

  const [migProjectId, setMigProjectId] = useState(projects[0]?.id || 'palash-ai');
  const [migTitle, setMigTitle] = useState('');
  const [migSql, setMigSql] = useState('');
  const [migNotice, setMigNotice] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [bootstrappingPg, setBootstrappingPg] = useState(false);
  const [bootstrapNotice, setBootstrapNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSchema = async () => {
    try {
      const res = await fetch('/api/database/tables', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMode(data.mode);
        setTables(data.tables || []);
        setPgConnected(Boolean(data.postgres?.connected));
        setPgDbName(data.postgres?.database || null);
      }
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadSchema();
  }, [token]);

  const handleRunQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunningQuery(true);
    setQueryError(null);
    setQueryResult(null);

    try {
      const res = await fetch('/api/database/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sql, target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQueryError(data.error || 'SQL execution blocked.');
      } else {
        setQueryResult(data);
      }
    } catch {
      setQueryError('Failed to reach database query endpoint.');
    } finally {
      setRunningQuery(false);
    }
  };

  const handleQueueMigration = async (e: React.FormEvent) => {
    e.preventDefault();
    setMigNotice(null);
    const res = await fetch('/api/database/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId: migProjectId, title: migTitle, sql: migSql }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMigNotice(data.error || 'Migration proposal failed.');
    } else {
      setMigNotice(`Queued mandatory Owner approval (${data.approval.id}) for "${migTitle}".`);
      setMigTitle('');
      setMigSql('');
      await onRefreshAll();
    }
  };

  const handleBackup = async () => {
    setBackupNotice(null);
    const res = await fetch('/api/system/backup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setBackupNotice(data.backup.content);
      await loadSchema();
      await onRefreshAll();
    }
  };

  const handleBootstrapPg = async () => {
    setBootstrappingPg(true);
    setBootstrapNotice(null);
    try {
      const res = await fetch('/api/database/bootstrap-pg', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setBootstrapNotice({
          ok: false,
          text: data.error || 'Unable to bootstrap Neon PostgreSQL schema.',
        });
      } else {
        setBootstrapNotice({
          ok: true,
          text: `Verified/created ${data.createdTables?.length || 7} core tables in ${data.database || 'Neon PostgreSQL'}.`,
        });
        await loadSchema();
        await onRefreshAll();
      }
    } catch {
      setBootstrapNotice({ ok: false, text: 'Network error contacting schema bootstrap endpoint.' });
    } finally {
      setBootstrappingPg(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Connection Summary & Backup */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Database and backups
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Database: <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{mode}</span>
            {pgConnected && pgDbName ? ` · Connected to ${pgDbName}` : ' · Set DATABASE_URL in Secrets to inspect & bootstrap live Neon PG 17'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!pgConnected || bootstrappingPg}
            onClick={handleBootstrapPg}
            title={
              pgConnected
                ? 'Create or verify the 7 canonical PALASH AI tables in Neon PostgreSQL'
                : 'Set DATABASE_URL in Secrets to enable Neon PostgreSQL schema bootstrap'
            }
            className="inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database className="h-4 w-4" aria-hidden="true" />
            <span>{bootstrappingPg ? 'Bootstrapping...' : 'Check / set up database tables'}</span>
          </button>

          <button
            type="button"
            onClick={handleBackup}
            className="inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <HardDriveDownload className="h-4 w-4" aria-hidden="true" />
            <span>Create a backup snapshot</span>
          </button>
        </div>
      </section>

      {bootstrapNotice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            bootstrapNotice.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
          }`}
        >
          {bootstrapNotice.text}
        </div>
      )}

      {backupNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          {backupNotice}
        </div>
      )}

      {/* 7-Table Schema Grid */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Available tables ({tables.length})
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tables.map((t) => (
            <button
              key={t.table}
              type="button"
              onClick={() => setSql(`SELECT * FROM ${t.table} LIMIT 20;`)}
              className="rounded-lg border border-slate-200 p-3.5 text-left transition-colors hover:border-teal-600 dark:border-slate-800 dark:hover:border-teal-500"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                  {t.table}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  {t.rows} {t.rows === 1 ? 'row' : 'rows'}
                </span>
              </div>
              <p className="mt-1.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {t.columns.join(', ')}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Safe SQL Runner */}
      <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span>Read database records with a SQL query</span><span className="text-xs font-semibold text-teal-700 dark:text-teal-400">Open</span>
        </summary>
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
<section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Run a safe SQL query
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Only SELECT, WITH, EXPLAIN, and SHOW TABLES run directly. Destructive SQL (DROP, TRUNCATE) and migrations are intercepted by the SQL Guard.
            </p>
          </div>
          {pgConnected && (
            <select
              aria-label="SQL Query Target"
              value={target}
              onChange={(e) => setTarget(e.target.value as 'local' | 'postgres')}
              className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="local">Local 7-Table Store</option>
              <option value="postgres">Neon PostgreSQL (READ ONLY)</option>
            </select>
          )}
        </div>

        <form onSubmit={handleRunQuery} className="mt-4 space-y-3">
          <label htmlFor="sql-query-editor" className="sr-only">
            SQL Query
          </label>
          <textarea
            id="sql-query-editor"
            rows={3}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSql('SHOW TABLES;')}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                SHOW TABLES
              </button>
              <button
                type="button"
                onClick={() => setSql('SELECT id, name, progress, status FROM projects;')}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                SELECT projects
              </button>
              <button
                type="button"
                onClick={() => setSql('DROP TABLE agents;')}
                className="rounded-md border border-red-200 px-2.5 py-1.5 font-mono text-[11px] text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                Test Guard (DROP)
              </button>
            </div>
            <button
              type="submit"
              disabled={runningQuery}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{runningQuery ? 'Executing...' : 'Run Safe Query'}</span>
            </button>
          </div>
        </form>

        {queryError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{queryError}</span>
          </div>
        )}

        {queryResult && (
          <div className="mt-4 space-y-2">
            <p className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {queryResult.rowCount} rows returned in {queryResult.executionMs}ms · Classification: {queryResult.classification}
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    {queryResult.columns.map((col) => (
                      <th key={col} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums dark:divide-slate-800">
                  {queryResult.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      {queryResult.columns.map((col) => (
                        <td key={col} className="max-w-[260px] truncate px-3 py-2 text-slate-800 dark:text-slate-200">
                          {typeof row[col] === 'object' && row[col] !== null
                            ? JSON.stringify(row[col])
                            : String(row[col] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
        </div>
      </details>

      {/* Migration Proposal Gate */}
      <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span>Propose a schema change (Owner approval required)</span><span className="text-xs font-semibold text-teal-700 dark:text-teal-400">Open</span>
        </summary>
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
<section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Propose a database change
        </h3>
        <form onSubmit={handleQueueMigration} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="mig-project" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Target Project Database
            </label>
            <select
              id="mig-project"
              value={migProjectId}
              onChange={(e) => setMigProjectId(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.dbIsolationLabel})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mig-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Migration Title
            </label>
            <input
              id="mig-title"
              type="text"
              required
              value={migTitle}
              onChange={(e) => setMigTitle(e.target.value)}
              placeholder="e.g., Add index on orders(created_at)"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="mig-sql" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Migration SQL
            </label>
            <input
              id="mig-sql"
              type="text"
              required
              value={migSql}
              onChange={(e) => setMigSql(e.target.value)}
              placeholder="ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 1;"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Queued migrations require explicit Owner sign-off in Approvals.
            </span>
            <button
              type="submit"
              className="min-h-[42px] rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-teal-600 dark:hover:bg-teal-700"
            >
              Queue Migration Approval
            </button>
          </div>
        </form>
        {migNotice && (
          <p className="mt-3 text-xs font-medium text-teal-700 dark:text-teal-400">{migNotice}</p>
        )}
      </section>
        </div>
      </details>
    </div>
  );
};
