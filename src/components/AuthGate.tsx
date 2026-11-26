import React, { useState } from 'react';
import { Lock, ShieldCheck, Sun, Moon, ArrowRight, Download } from 'lucide-react';
import type { AuthUser, HealthStatus } from '../types';

interface AuthGateProps {
  needsSetup: boolean;
  envAdminConfigured: boolean;
  suggestedEmail: string;
  health: HealthStatus | null;
  darkMode: boolean;
  onToggleTheme: () => void;
  onAuthenticated: (token: string, user: AuthUser) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  needsSetup,
  envAdminConfigured,
  suggestedEmail,
  health,
  darkMode,
  onToggleTheme,
  onAuthenticated,
}) => {
  const [email, setEmail] = useState(suggestedEmail || 'mohammedpalash1990@gmail.com');
  const [name, setName] = useState('Palash Owner');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
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
      setError('Download failed. Please try again or check network connectivity.');
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const endpoint = needsSetup ? '/api/auth/setup' : '/api/auth/login';
      const body = needsSetup ? { email, name, password } : { email, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed.');
        setSubmitting(false);
        return;
      }
      onAuthenticated(data.token, data.user);
    } catch {
      setError('Unable to reach PALASH AI server. Check connectivity and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col justify-between">
      <header className="flex items-center justify-between gap-8 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          PALASH AI
        </span>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-12">
        <div className="grid w-full gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
              Phase 1 Runtime · Autonomous Agent Platform
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl text-balance">
              {needsSetup
                ? 'Initialize your Owner Console'
                : 'Sign in to PALASH AI Command Center'}
            </h1>
            <p className="text-base leading-relaxed text-slate-600 dark:text-slate-400">
              {needsSetup
                ? 'Claim the primary Owner account to unlock Chief Agent orchestration, six specialist workers, GitHub engineering workflows, database governance, and approval controls.'
                : 'Authenticate with your Owner credentials to manage projects, agent queues, approvals, and live financial reporting.'}
            </p>

            <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                System Initialization Readiness
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Database Tables</dt>
                  <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {health ? `${health.database.tablesCount} tables ready` : 'Checking...'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Agent Roster</dt>
                  <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {health ? `${health.agentsCount} agents initialized` : 'Checking...'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Neon PostgreSQL</dt>
                  <dd className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                    {health?.database.postgres.connected
                      ? `Connected (${health.database.postgres.database})`
                      : health?.database.postgres.configured
                        ? 'Connection error'
                        : 'Local store active (DATABASE_URL optional)'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">AI Provider</dt>
                  <dd className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                    {health?.geminiConfigured ? 'Gemini Server Key Active' : 'Pending GEMINI_API_KEY'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
                  {needsSetup ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {needsSetup ? 'First-Run Owner Claim' : 'Owner Sign In'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {envAdminConfigured
                      ? 'Verified against configured environment ADMIN_EMAIL & ADMIN_PASSWORD'
                      : 'Scrypt hashed server-side · In-memory Bearer session'}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {needsSetup && (
                  <div>
                    <label
                      htmlFor="owner-name"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Owner Display Name
                    </label>
                    <input
                      id="owner-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="owner-email"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Owner Email
                  </label>
                  <input
                    id="owner-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="mohammedpalash1990@gmail.com"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="owner-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    {needsSetup ? 'Create Owner Password (min. 8 characters)' : 'Owner Password'}
                  </label>
                  <input
                    id="owner-password"
                    type="password"
                    required
                    minLength={needsSetup ? 8 : 1}
                    autoComplete={needsSetup ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
                >
                  <span>
                    {submitting
                      ? 'Verifying...'
                      : needsSetup
                        ? 'Claim Owner Account & Enter'
                        : 'Sign In to Dashboard'}
                  </span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    disabled={downloadingZip}
                    onClick={handleDownloadZip}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 hover:underline dark:text-teal-400 dark:hover:text-teal-300"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{downloadingZip ? 'Downloading ZIP archive...' : 'Or Download Entire Project Source (ZIP)'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        PALASH AI · Role-Based Owner Access · Free-Tier Infrastructure Policy
      </footer>
    </div>
  );
};
