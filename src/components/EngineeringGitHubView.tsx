import React, { useState } from 'react';
import { Code2, FileCode2, FolderOpen, GitBranch, GitPullRequest, Search } from 'lucide-react';
import type { ProjectItem } from '../types';

interface InspectionResult {
  owner: string;
  repo: string;
  accessible: boolean;
  authenticated: boolean;
  visibility: string | null;
  defaultBranch: string | null;
  description: string | null;
  openIssuesCount: number | null;
  stars: number | null;
  updatedAt: string | null;
  branches: Array<{ name: string; protected: boolean }>;
  recentCommits: Array<{ sha: string; message: string; author: string; date: string }>;
  openPullRequests: Array<{ number: number; title: string; state: string; author: string; branch: string }>;
  error: string | null;
}

interface RepoFileEntry {
  path: string;
  size: number;
  type: string;
}

interface CodeAnalysisResult {
  path: string;
  size: number;
  content: string;
  analysis: string;
}

interface EngineeringGitHubViewProps {
  token: string;
  projects: ProjectItem[];
  onQueuePRProposal: (payload: {
    projectId: string;
    branch: string;
    title: string;
    summary: string;
  }) => Promise<void>;
  busyAction: string | null;
}

export const EngineeringGitHubView: React.FC<EngineeringGitHubViewProps> = ({
  token,
  projects,
  onQueuePRProposal,
  busyAction,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || 'palash-ai');
  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const [repoOwner, setRepoOwner] = useState(activeProject?.repoOwner || 'mohammedpalash1990-a11y');
  const [repoName, setRepoName] = useState(activeProject?.repoName || '-PALASH-AI');
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [analyzingPath, setAnalyzingPath] = useState<string | null>(null);
  const [codeAnalysis, setCodeAnalysis] = useState<CodeAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [prBranch, setPrBranch] = useState('feat/agent-patch');
  const [prTitle, setPrTitle] = useState('');
  const [prSummary, setPrSummary] = useState('');

  const handleProjectPick = (projId: string) => {
    setSelectedProjectId(projId);
    const p = projects.find((item) => item.id === projId);
    if (p) {
      setRepoOwner(p.repoOwner);
      setRepoName(p.repoName);
    }
  };

  const loadRepositoryFiles = async (owner: string, repo: string, branch: string) => {
    setLoadingFiles(true);
    setFilesError(null);
    try {
      const res = await fetch('/api/github/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ owner, repo, branch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFilesError(data.error || 'Unable to load repository files.');
      } else {
        setFiles(data.files || []);
      }
    } catch {
      setFilesError('Failed to reach GitHub file listing endpoint.');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    setInspecting(true);
    setInspectError(null);
    setFiles([]);
    setFilesError(null);
    setCodeAnalysis(null);
    setAnalysisError(null);
    try {
      const res = await fetch('/api/github/inspect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ owner: repoOwner.trim(), repo: repoName.trim() }),
      });
      const data: InspectionResult = await res.json();
      if (!res.ok) {
        setInspectError((data as unknown as { error?: string }).error || 'Repository inspection failed.');
      } else {
        setInspection(data);
        if (data.accessible) {
          await loadRepositoryFiles(data.owner, data.repo, data.defaultBranch || 'main');
        }
      }
    } catch {
      setInspectError('Failed to reach GitHub inspection API.');
    } finally {
      setInspecting(false);
    }
  };

  const handleAnalyzeFile = async (filePath: string) => {
    if (!inspection) return;
    setAnalyzingPath(filePath);
    setAnalysisError(null);
    try {
      const res = await fetch('/api/github/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          owner: inspection.owner,
          repo: inspection.repo,
          filePath,
          branch: inspection.defaultBranch || 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalysisError(data.error || 'AI source analysis failed.');
      } else {
        setCodeAnalysis(data);
      }
    } catch {
      setAnalysisError('Network error running AI code analysis.');
    } finally {
      setAnalyzingPath(null);
    }
  };

  const handleSubmitPR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prTitle.trim()) return;
    await onQueuePRProposal({
      projectId: selectedProjectId,
      branch: prBranch.trim() || 'feat/agent-patch',
      title: prTitle.trim(),
      summary: prSummary.trim(),
    });
    setPrTitle('');
    setPrSummary('');
  };

  return (
    <div className="space-y-8">
      {/* Repository Selector & Live Inspector */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-4 dark:border-slate-800">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            GitHub Repository &amp; Branch Inspector
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Inspect branches, commit history, repository files, and AI code reviews via SSRF-allowlisted GitHub API. Private repositories use server-side GITHUB_TOKEN when configured.
          </p>
        </div>

        <form onSubmit={handleInspect} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="gh-project-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Registered Project
            </label>
            <select
              id="gh-project-select"
              value={selectedProjectId}
              onChange={(e) => handleProjectPick(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="gh-owner" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              GitHub Owner / Org
            </label>
            <input
              id="gh-owner"
              type="text"
              required
              value={repoOwner}
              onChange={(e) => setRepoOwner(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label htmlFor="gh-repo" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Repository Name
            </label>
            <input
              id="gh-repo"
              type="text"
              required
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={inspecting}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <span>{inspecting ? 'Inspecting...' : 'Inspect Repository'}</span>
            </button>
          </div>
        </form>

        {inspectError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {inspectError}
          </div>
        )}

        {inspection && (
          <div className="mt-6 space-y-6 border-t border-slate-100 pt-5 dark:border-slate-800">
            {!inspection.accessible ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-semibold">
                  {inspection.owner}/{inspection.repo} is private or requires credentials
                </p>
                <p className="mt-1">{inspection.error}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Visibility</p>
                    <p className="mt-1 font-mono text-sm font-semibold text-slate-900 dark:text-white">
                      {inspection.visibility}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Default Branch</p>
                    <p className="mt-1 font-mono text-sm font-semibold text-slate-900 dark:text-white">
                      {inspection.defaultBranch}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Open Issues</p>
                    <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {inspection.openIssuesCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Stars</p>
                    <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {inspection.stars}
                    </p>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <GitBranch className="h-4 w-4 text-teal-600" aria-hidden="true" />
                      <span>Branches ({inspection.branches.length})</span>
                    </h3>
                    <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {inspection.branches.map((b) => (
                        <li key={b.name} className="flex items-center justify-between py-2 text-xs">
                          <span className="font-mono text-slate-800 dark:text-slate-200">{b.name}</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {b.protected ? 'Protected' : 'Open'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <GitPullRequest className="h-4 w-4 text-teal-600" aria-hidden="true" />
                      <span>Recent Commits ({inspection.recentCommits.length})</span>
                    </h3>
                    <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {inspection.recentCommits.map((c) => (
                        <li key={c.sha} className="py-2 text-xs">
                          <p className="truncate font-medium text-slate-900 dark:text-white">
                            <span className="font-mono text-teal-700 dark:text-teal-400">{c.sha}</span> · {c.message}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {c.author} · {c.date ? new Date(c.date).toLocaleDateString() : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Phase 3: Source Tree & AI Code Auditor */}
                <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <FolderOpen className="h-4 w-4 text-teal-600" aria-hidden="true" />
                      <span>Repository Source Files ({files.length})</span>
                    </h3>
                    <button
                      type="button"
                      disabled={loadingFiles}
                      onClick={() =>
                        loadRepositoryFiles(
                          inspection.owner,
                          inspection.repo,
                          inspection.defaultBranch || 'main'
                        )
                      }
                      className="inline-flex min-h-[36px] items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <span>{loadingFiles ? 'Loading tree...' : 'Reload File Tree'}</span>
                    </button>
                  </div>

                  {filesError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{filesError}</p>
                  )}

                  {files.length > 0 && (
                    <ul className="mt-3 max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {files.map((file) => (
                        <li
                          key={file.path}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="truncate font-mono text-slate-800 dark:text-slate-200">
                              {file.path}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                              {file.size >= 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={analyzingPath !== null}
                            onClick={() => handleAnalyzeFile(file.path)}
                            className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:border-teal-600 hover:text-teal-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-500 dark:hover:text-teal-400"
                          >
                            <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {analyzingPath === file.path ? 'Analyzing...' : 'Analyze Code'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {analysisError && (
                    <div
                      role="alert"
                      className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                    >
                      {analysisError}
                    </div>
                  )}

                  {codeAnalysis && (
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-800">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white">
                            {codeAnalysis.path}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            {codeAnalysis.size} bytes
                          </span>
                        </div>
                        <pre className="mt-3 max-h-72 overflow-auto font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-200">
                          {codeAnalysis.content}
                        </pre>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                        <p className="border-b border-slate-200 pb-2 text-xs font-semibold text-teal-700 dark:border-slate-800 dark:text-teal-400">
                          Software Engineer &amp; Quality Auditor Review
                        </p>
                        <div className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                          {codeAnalysis.analysis}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Propose Branch Change & Merge Approval Gate */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Propose Branch Code Change &amp; PR Merge Gate
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Branch changes operate under restricted permissions and queue an Owner approval check before merging to {activeProject?.defaultBranch || 'main'}.
        </p>

        <form onSubmit={handleSubmitPR} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pr-branch" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Feature Branch
            </label>
            <input
              id="pr-branch"
              type="text"
              required
              value={prBranch}
              onChange={(e) => setPrBranch(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label htmlFor="pr-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Pull Request Title
            </label>
            <input
              id="pr-title"
              type="text"
              required
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder="e.g., Fix POS thermal receipt tax rounding"
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="pr-summary" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Change Scope &amp; Verification Plan
            </label>
            <input
              id="pr-summary"
              type="text"
              value={prSummary}
              onChange={(e) => setPrSummary(e.target.value)}
              placeholder="Describe affected modules, test coverage, and rollback plan..."
              className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busyAction === 'propose-pr' || !prTitle.trim()}
              className="min-h-[42px] rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busyAction === 'propose-pr' ? 'Queuing...' : 'Queue Branch & PR Approval'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
