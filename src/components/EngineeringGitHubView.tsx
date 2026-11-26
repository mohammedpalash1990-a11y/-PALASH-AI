import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  KeyRound,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
  UploadCloud,
} from 'lucide-react';
import type { ProjectItem } from '../types';

interface GitHubConnectionStatus {
  connected: boolean;
  mode: 'env_pat' | 'oauth' | 'session_pat' | 'none';
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  hasEnvToken: boolean;
  oauthConfigured: boolean;
  callbackUrl: string;
  connectedAt: string | null;
}

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

interface WorkspaceDiffFile {
  path: string;
  status: 'added' | 'modified' | 'unchanged';
  localSize: number;
  remoteSize: number | null;
  localSha: string;
  remoteSha: string | null;
}

interface WorkspaceDiffResult {
  owner: string;
  repo: string;
  branch: string;
  branchExists: boolean;
  isEmptyRepo: boolean;
  remoteHeadSha: string | null;
  baseTreeSha: string | null;
  files: WorkspaceDiffFile[];
  remoteOnlyCount: number;
  summary: {
    added: number;
    modified: number;
    unchanged: number;
    total: number;
  };
}

interface PushExecutionOutcome {
  queuedForApproval: boolean;
  result?: {
    owner: string;
    repo: string;
    branch: string;
    baseBranch: string;
    commitSha: string;
    commitUrl: string;
    filesPushed: number;
    prNumber: number | null;
    prUrl: string | null;
  };
  approval?: {
    id: string;
    title: string;
  };
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
  onRefreshWorkspace?: () => Promise<void>;
  onNavigateApprovals?: () => void;
  busyAction: string | null;
}

export const EngineeringGitHubView: React.FC<EngineeringGitHubViewProps> = ({
  token,
  projects,
  onQueuePRProposal,
  onRefreshWorkspace,
  onNavigateApprovals,
  busyAction,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || 'palash-ai');
  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const [repoOwner, setRepoOwner] = useState(activeProject?.repoOwner || 'mohammedpalash1990-a11y');
  const [repoName, setRepoName] = useState(activeProject?.repoName || '-PALASH-AI');

  // GitHub Connection / OAuth / Session PAT state
  const [connection, setConnection] = useState<GitHubConnectionStatus | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [patInput, setPatInput] = useState('');
  const [connectingAuth, setConnectingAuth] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [copiedCloneCmd, setCopiedCloneCmd] = useState(false);
  const [bindingRemote, setBindingRemote] = useState(false);

  // Inspector & AI Code Review state
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [analyzingPath, setAnalyzingPath] = useState<string | null>(null);
  const [codeAnalysis, setCodeAnalysis] = useState<CodeAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Workspace Diff & Push Engine state
  const [diffBaseBranch, setDiffBaseBranch] = useState(activeProject?.defaultBranch || 'main');
  const [diffResult, setDiffResult] = useState<WorkspaceDiffResult | null>(null);
  const [scanningDiff, setScanningDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<'changed' | 'all'>('changed');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [pushBranch, setPushBranch] = useState('feat/palash-ai-sync');
  const [commitMessage, setCommitMessage] = useState('feat: sync PALASH AI command center updates');
  const [createPrOnPush, setCreatePrOnPush] = useState(true);
  const [prPushTitle, setPrPushTitle] = useState('Sync PALASH AI autonomous command center updates');
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushOutcome, setPushOutcome] = useState<PushExecutionOutcome | null>(null);

  // Legacy PR Proposal Gate state
  const [prBranch, setPrBranch] = useState('feat/agent-patch');
  const [prTitle, setPrTitle] = useState('');
  const [prSummary, setPrSummary] = useState('');

  const fetchConnectionStatus = useCallback(async () => {
    setLoadingConnection(true);
    try {
      const res = await fetch('/api/github/connection', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: GitHubConnectionStatus = await res.json();
        setConnection(data);
      }
    } finally {
      setLoadingConnection(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchConnectionStatus();
  }, [fetchConnectionStatus]);

  // Listen for GitHub OAuth popup completion messages
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'GITHUB_OAUTH_SUCCESS') {
        setAuthFeedback({
          kind: 'info',
          text: `Connected GitHub account @${event.data.login || 'authenticated'} via OAuth.`,
        });
        void fetchConnectionStatus();
        if (onRefreshWorkspace) void onRefreshWorkspace();
      } else if (event.data?.type === 'GITHUB_OAUTH_ERROR') {
        setAuthFeedback({
          kind: 'error',
          text: event.data.error || 'GitHub OAuth authorization was cancelled or failed.',
        });
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [fetchConnectionStatus, onRefreshWorkspace]);

  const handleProjectPick = (projId: string) => {
    setSelectedProjectId(projId);
    const p = projects.find((item) => item.id === projId);
    if (p) {
      setRepoOwner(p.repoOwner);
      setRepoName(p.repoName);
      setDiffBaseBranch(p.defaultBranch || 'main');
      setDiffResult(null);
      setSelectedPaths([]);
      setPushOutcome(null);
    }
  };

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
      setAuthFeedback({
        kind: 'error',
        text: 'Failed to download project ZIP archive. Please retry.',
      });
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleConnectPat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patInput.trim()) return;
    setConnectingAuth(true);
    setAuthFeedback(null);
    try {
      const res = await fetch('/api/github/connect-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: patInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthFeedback({ kind: 'error', text: data.error || 'Token verification failed.' });
      } else {
        setConnection(data);
        setPatInput('');
        setAuthFeedback({
          kind: 'info',
          text: `Verified & connected GitHub account @${data.login} in server memory.`,
        });
        if (onRefreshWorkspace) await onRefreshWorkspace();
      }
    } catch {
      setAuthFeedback({ kind: 'error', text: 'Network error connecting GitHub token.' });
    } finally {
      setConnectingAuth(false);
    }
  };

  const handleConnectOAuth = async () => {
    setAuthFeedback(null);
    setConnectingAuth(true);
    try {
      const res = await fetch('/api/github/oauth/url', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setAuthFeedback({
          kind: 'error',
          text: data.error || 'GitHub OAuth credentials are not configured on the server.',
        });
        return;
      }
      const popup = window.open(data.url, 'github_oauth_popup', 'width=640,height=740');
      if (!popup) {
        setAuthFeedback({
          kind: 'error',
          text: 'Browser blocked the authorization popup. Allow popups for this site and retry.',
        });
      }
    } catch {
      setAuthFeedback({ kind: 'error', text: 'Failed to initiate GitHub OAuth flow.' });
    } finally {
      setConnectingAuth(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    setConnectingAuth(true);
    setAuthFeedback(null);
    try {
      const res = await fetch('/api/github/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: GitHubConnectionStatus = await res.json();
        setConnection(data);
        setAuthFeedback({ kind: 'info', text: 'Disconnected session GitHub token.' });
        if (onRefreshWorkspace) await onRefreshWorkspace();
      }
    } finally {
      setConnectingAuth(false);
    }
  };

  const handleBindLocalRemote = async () => {
    setBindingRemote(true);
    setAuthFeedback(null);
    try {
      const res = await fetch('/api/github/sync-local-remote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ owner: repoOwner.trim(), repo: repoName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthFeedback({ kind: 'error', text: data.error || 'Failed to bind local git remote.' });
      } else {
        setAuthFeedback({
          kind: 'info',
          text: data.gitAvailable
            ? `Workspace git remote origin bound to ${data.remoteUrl}`
            : `Target repository set to ${data.remoteUrl} (git CLI unavailable; using HTTPS API sync).`,
        });
        if (onRefreshWorkspace) await onRefreshWorkspace();
      }
    } finally {
      setBindingRemote(false);
    }
  };

  const handleCopyCloneCmd = async () => {
    const cmd = `gh repo clone ${repoOwner.trim()}/${repoName.trim()}`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCloneCmd(true);
      setTimeout(() => setCopiedCloneCmd(false), 1800);
    } catch {
      setAuthFeedback({ kind: 'info', text: `Command: ${cmd}` });
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
          const defBranch = data.defaultBranch || 'main';
          setDiffBaseBranch(defBranch);
          await loadRepositoryFiles(data.owner, data.repo, defBranch);
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

  const handleScanDiff = async () => {
    setScanningDiff(true);
    setDiffError(null);
    setPushError(null);
    setPushOutcome(null);
    try {
      const res = await fetch('/api/github/diff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          owner: repoOwner.trim(),
          repo: repoName.trim(),
          branch: diffBaseBranch.trim() || 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDiffError(data.error || 'Workspace diff scan failed.');
      } else {
        const parsed: WorkspaceDiffResult = data;
        setDiffResult(parsed);
        const changed = parsed.files
          .filter((f) => f.status === 'added' || f.status === 'modified')
          .map((f) => f.path);
        setSelectedPaths(changed);
      }
    } catch {
      setDiffError('Network error comparing workspace files with GitHub.');
    } finally {
      setScanningDiff(false);
    }
  };

  const handleToggleFile = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    );
  };

  const handleSelectChanged = () => {
    if (!diffResult) return;
    setSelectedPaths(
      diffResult.files.filter((f) => f.status !== 'unchanged').map((f) => f.path)
    );
  };

  const handleSelectAllFiles = () => {
    if (!diffResult) return;
    setSelectedPaths(diffResult.files.map((f) => f.path));
  };

  const handlePushToGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim() || selectedPaths.length === 0) return;
    setPushing(true);
    setPushError(null);
    setPushOutcome(null);
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: selectedProjectId,
          owner: repoOwner.trim(),
          repo: repoName.trim(),
          targetBranch: pushBranch.trim() || 'feat/palash-ai-sync',
          baseBranch: diffBaseBranch.trim() || 'main',
          commitMessage: commitMessage.trim(),
          filePaths: selectedPaths,
          createPullRequest: createPrOnPush && pushBranch.trim() !== (diffBaseBranch.trim() || 'main'),
          prTitle: prPushTitle.trim() || commitMessage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPushError(data.error || 'Failed to push changes to GitHub.');
      } else {
        setPushOutcome(data);
        if (onRefreshWorkspace) await onRefreshWorkspace();
        if (!data.queuedForApproval) {
          await handleScanDiff();
        }
      }
    } catch {
      setPushError('Network error pushing changes to GitHub.');
    } finally {
      setPushing(false);
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

  const visibleDiffFiles = diffResult
    ? diffFilter === 'changed'
      ? diffResult.files.filter((f) => f.status !== 'unchanged')
      : diffResult.files
    : [];

  const isTargetProtected =
    pushBranch.trim() === (diffBaseBranch.trim() || 'main') ||
    pushBranch.trim() === 'main' ||
    pushBranch.trim() === 'master';

  return (
    <div className="space-y-8">
      {/* Section 1: GitHub Authentication & Repository Connection */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              GitHub Account Connection
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {loadingConnection
                ? 'Checking server GitHub credentials...'
                : connection?.connected
                  ? `Connected as @${connection.login || 'authenticated'} · Auth mode: ${
                      connection.mode === 'env_pat'
                        ? 'Server Secret (GITHUB_TOKEN)'
                        : connection.mode === 'oauth'
                          ? 'GitHub OAuth Session'
                          : 'Owner Session PAT (In-Memory)'
                    }${connection.scopes.length > 0 ? ` · Scopes: ${connection.scopes.join(', ')}` : ''}`
                  : 'Public API only (rate-limited). Connect GitHub via OAuth or Personal Access Token to push commits and pull requests.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyCloneCmd}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {copiedCloneCmd ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              <span className="font-mono">
                {copiedCloneCmd ? 'Copied gh clone' : `gh repo clone ${repoOwner}/${repoName}`}
              </span>
            </button>

            <button
              type="button"
              disabled={downloadingZip}
              onClick={handleDownloadZip}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-teal-600 bg-teal-50 px-3.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-950/70"
            >
              <Download className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <span>{downloadingZip ? 'Downloading ZIP...' : 'Download Project ZIP'}</span>
            </button>

            <button
              type="button"
              disabled={bindingRemote}
              onClick={handleBindLocalRemote}
              className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Link2 className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
              <span>{bindingRemote ? 'Binding Remote...' : 'Bind Local Remote'}</span>
            </button>

            {connection?.connected && connection.mode !== 'env_pat' && (
              <button
                type="button"
                disabled={connectingAuth}
                onClick={handleDisconnectGitHub}
                className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-slate-950 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-12">
          <form onSubmit={handleConnectPat} className="lg:col-span-7 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="gh-session-pat" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                GitHub Personal Access Token (Server Session Memory Only)
              </label>
              <input
                id="gh-session-pat"
                type="password"
                value={patInput}
                onChange={(e) => setPatInput(e.target.value)}
                placeholder="ghp_... or github_pat_... (needs repo write scope to push)"
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={connectingAuth || !patInput.trim()}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{connectingAuth ? 'Verifying...' : 'Verify & Connect PAT'}</span>
            </button>
          </form>

          <div className="lg:col-span-5 flex flex-col justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Browser OAuth Authorization
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {connection?.oauthConfigured
                    ? 'OAuth client configured · Opens GitHub popup'
                    : 'Set GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET to enable popup'}
                </p>
              </div>
              <button
                type="button"
                disabled={connectingAuth}
                onClick={handleConnectOAuth}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Connect OAuth</span>
              </button>
            </div>
            {connection?.callbackUrl && (
              <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Callback: {connection.callbackUrl}
              </p>
            )}
          </div>
        </div>

        {authFeedback && (
          <div
            role={authFeedback.kind === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-lg border px-4 py-3 text-xs ${
              authFeedback.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
            }`}
          >
            {authFeedback.text}
          </div>
        )}
      </section>

      {/* Section 2: Repository Selector & Live Inspector */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-4 dark:border-slate-800">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            GitHub Repository &amp; Branch Inspector
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Inspect branches, commit history, repository files, and AI code reviews for <span className="font-mono">{repoOwner}/{repoName}</span>.
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
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
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
                  Unable to fetch {inspection.owner}/{inspection.repo}
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

                {/* Source Tree & AI Code Auditor */}
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

      {/* Section 3: Workspace Sync, Diff & Push to GitHub */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Workspace Sync &amp; Push to {repoOwner}/{repoName}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Compare local PALASH AI workspace files against GitHub, select files to stage, and push via branch PR or Owner-approved direct commit.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="diff-base-branch" className="sr-only">
              Compare Base Branch
            </label>
            <input
              id="diff-base-branch"
              type="text"
              value={diffBaseBranch}
              onChange={(e) => setDiffBaseBranch(e.target.value)}
              placeholder="main"
              className="min-h-[40px] w-28 rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              disabled={scanningDiff}
              onClick={handleScanDiff}
              className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanningDiff ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{scanningDiff ? 'Scanning Workspace...' : 'Scan & Compare Changes'}</span>
            </button>
          </div>
        </div>

        {diffError && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            {diffError}
          </div>
        )}

        {!diffResult && !diffError && (
          <div className="mt-5 rounded-lg border border-dashed border-slate-200 p-6 text-center dark:border-slate-800">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Ready to compare workspace files with {repoOwner}/{repoName}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Click Scan &amp; Compare Changes to compute exact Git SHA-1 diffs across your codebase (secret files like .env and .data are automatically excluded).
            </p>
          </div>
        )}

        {diffResult && (
          <div className="mt-5 space-y-5">
            {/* Summary Stats Row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
                <span>
                  Target:{' '}
                  <strong className="font-mono text-slate-900 dark:text-white">
                    {diffResult.owner}/{diffResult.repo}@{diffResult.branch}
                  </strong>
                  {diffResult.isEmptyRepo
                    ? ' (Empty Repo)'
                    : !diffResult.branchExists
                      ? ' (New Branch)'
                      : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {diffResult.summary.added} added
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {diffResult.summary.modified} modified
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {diffResult.summary.unchanged} unchanged
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                  {selectedPaths.length} selected
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setDiffFilter('changed')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      diffFilter === 'changed'
                        ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Changed ({diffResult.summary.added + diffResult.summary.modified})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiffFilter('all')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      diffFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    All ({diffResult.summary.total})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSelectChanged}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Select Changed
                </button>
                <button
                  type="button"
                  onClick={handleSelectAllFiles}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPaths([])}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Compact High-Density Diff File Table */}
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              {visibleDiffFiles.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Workspace matches {diffResult.owner}/{diffResult.repo}@{diffResult.branch} — zero pending changes. Switch to All to inspect all files.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="w-10 px-3 py-2.5">Stage</th>
                      <th className="px-3 py-2.5 font-semibold">Workspace Path</th>
                      <th className="px-3 py-2.5 font-semibold">Diff Status</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {visibleDiffFiles.map((file) => {
                      const checked = selectedPaths.includes(file.path);
                      return (
                        <tr
                          key={file.path}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleFile(file.path)}
                              aria-label={`Stage ${file.path}`}
                              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">
                            {file.path}
                          </td>
                          <td
                            className={`px-3 py-2 font-medium capitalize ${
                              file.status === 'added'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : file.status === 'modified'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {file.status}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {file.localSize >= 1024
                              ? `${(file.localSize / 1024).toFixed(1)} KB`
                              : `${file.localSize} B`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Commit & Push Form */}
            <form
              onSubmit={handlePushToGitHub}
              className="grid gap-4 border-t border-slate-100 pt-5 dark:border-slate-800 sm:grid-cols-2"
            >
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="push-target-branch" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Target Push Branch
                  </label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setPushBranch('feat/palash-ai-sync')}
                      className="text-teal-700 hover:underline dark:text-teal-400"
                    >
                      feat/palash-ai-sync
                    </button>
                    <span className="text-slate-400">/</span>
                    <button
                      type="button"
                      onClick={() => setPushBranch(diffBaseBranch || 'main')}
                      className="text-amber-700 hover:underline dark:text-amber-400"
                    >
                      {diffBaseBranch || 'main'} (Approval Gate)
                    </button>
                  </div>
                </div>
                <input
                  id="push-target-branch"
                  type="text"
                  required
                  value={pushBranch}
                  onChange={(e) => setPushBranch(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label htmlFor="push-commit-msg" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Commit Message
                </label>
                <input
                  id="push-commit-msg"
                  type="text"
                  required
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="feat: push completed PALASH AI modules"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {!isTargetProtected && (
                <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 sm:items-center">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={createPrOnPush}
                      onChange={(e) => setCreatePrOnPush(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span>Automatically open Pull Request targeting {diffBaseBranch || 'main'}</span>
                  </label>
                  {createPrOnPush && (
                    <div>
                      <label htmlFor="push-pr-title" className="sr-only">
                        Pull Request Title
                      </label>
                      <input
                        id="push-pr-title"
                        type="text"
                        value={prPushTitle}
                        onChange={(e) => setPrPushTitle(e.target.value)}
                        placeholder="Pull Request title..."
                        className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isTargetProtected ? (
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      Protected branch ({pushBranch}): pushing queues an Owner Approval Gate before writing to GitHub.
                    </span>
                  ) : (
                    <span>
                      Feature branch ({pushBranch}): commits directly and{createPrOnPush ? ` opens PR to ${diffBaseBranch || 'main'}.` : ' skips PR.'}
                    </span>
                  )}
                </p>

                <button
                  type="submit"
                  disabled={
                    pushing ||
                    selectedPaths.length === 0 ||
                    !commitMessage.trim() ||
                    !connection?.connected
                  }
                  className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {isTargetProtected ? (
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <UploadCloud className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {pushing
                      ? 'Pushing to GitHub...'
                      : isTargetProtected
                        ? `Queue Direct Push (${selectedPaths.length} files)`
                        : `Push ${selectedPaths.length} File(s) to GitHub`}
                  </span>
                </button>
              </div>
            </form>

            {pushError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              >
                {pushError}
              </div>
            )}

            {pushOutcome && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                {pushOutcome.queuedForApproval ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold">
                        Direct Push Queued for Owner Approval Gate
                      </p>
                      <p className="mt-1 text-emerald-800 dark:text-emerald-300">
                        {pushOutcome.approval?.title} is awaiting your approval in Approvals &amp; Safety before writing to {repoOwner}/{repoName}.
                      </p>
                    </div>
                    {onNavigateApprovals && (
                      <button
                        type="button"
                        onClick={onNavigateApprovals}
                        className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Review &amp; Approve Push</span>
                      </button>
                    )}
                  </div>
                ) : pushOutcome.result ? (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-2 font-semibold">
                      <GitCommitHorizontal className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>
                        Pushed {pushOutcome.result.filesPushed} file(s) to {pushOutcome.result.owner}/{pushOutcome.result.repo}@{pushOutcome.result.branch}
                      </span>
                    </p>
                    <p className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
                      <a
                        href={pushOutcome.result.commitUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-teal-700"
                      >
                        Commit {pushOutcome.result.commitSha.slice(0, 7)}
                      </a>
                      {pushOutcome.result.prUrl && (
                        <a
                          href={pushOutcome.result.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 hover:text-teal-700"
                        >
                          Pull Request #{pushOutcome.result.prNumber}
                        </a>
                      )}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 4: Propose Branch Change & Merge Approval Gate */}
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
