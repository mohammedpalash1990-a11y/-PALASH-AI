import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitHubAuthMode = 'env_pat' | 'oauth' | 'session_pat' | 'none';

export interface GitHubConnectionStatus {
  connected: boolean;
  mode: GitHubAuthMode;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  hasEnvToken: boolean;
  oauthConfigured: boolean;
  callbackUrl: string;
  connectedAt: string | null;
}

export interface GitHubInspectionResult {
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

export interface WorkspaceFileEntry {
  path: string;
  size: number;
  sha: string;
}

export interface WorkspaceDiffFile {
  path: string;
  status: 'added' | 'modified' | 'unchanged';
  localSize: number;
  remoteSize: number | null;
  localSha: string;
  remoteSha: string | null;
}

export interface WorkspaceDiffResult {
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

export interface PushWorkspaceInput {
  owner: string;
  repo: string;
  targetBranch: string;
  baseBranch?: string;
  commitMessage: string;
  filePaths: string[];
  createPullRequest?: boolean;
  prTitle?: string;
  prBody?: string;
}

export interface PushWorkspaceResult {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  commitSha: string;
  commitUrl: string;
  filesPushed: number;
  prNumber: number | null;
  prUrl: string | null;
}

const VALID_GITHUB_SEGMENT = /^[a-zA-Z0-9_.-]+$/;
const VALID_BRANCH_NAME = /^[a-zA-Z0-9._/-]+$/;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dev-dist',
  '.data',
  '.aistudio',
  '.playwright-cli',
  '.next',
  '.vercel',
  'coverage',
]);

const MAX_SCAN_FILE_BYTES = 1_048_576; // 1 MB limit per synced file

interface SessionGitHubAuth {
  mode: 'oauth' | 'session_pat';
  token: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string;
}

let sessionAuth: SessionGitHubAuth | null = null;
let cachedEnvIdentity: {
  tokenHash: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
} | null = null;

const pendingOAuthStates = new Map<string, number>();

export function getGitHubCallbackUrl(): string {
  const rawAppUrl = process.env.APP_URL?.trim();
  const base =
    rawAppUrl && rawAppUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(rawAppUrl)
      ? rawAppUrl.replace(/\/+$/, '')
      : 'http://localhost:3000';
  return `${base}/auth/github/callback`;
}

export function isGitHubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim());
}

export function resolveGitHubToken(): { token: string | undefined; mode: GitHubAuthMode } {
  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, mode: 'env_pat' };
  }
  if (sessionAuth?.token) {
    return { token: sessionAuth.token, mode: sessionAuth.mode };
  }
  return { token: undefined, mode: 'none' };
}

async function githubFetchJson<T>(
  apiPath: string,
  token?: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null; headers: Headers }> {
  const url = new URL(`https://api.github.com${apiPath}`);
  if (url.hostname !== 'api.github.com') {
    throw new Error('SSRF guard: invalid GitHub API host');
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PALASH-AI-Platform',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url.toString(), {
    method: init?.method || 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    let msg = `GitHub API responded HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody?.message) msg = `${msg}: ${errBody.message}`;
    } catch {
      // ignore json parse issue
    }
    return { ok: false, status: res.status, data: null, error: msg, headers: res.headers };
  }
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data, error: null, headers: res.headers };
}

async function fetchGitHubUserProfile(token: string): Promise<{
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
}> {
  const resp = await githubFetchJson<{
    login?: string;
    name?: string;
    avatar_url?: string;
  }>('/user', token);

  if (!resp.ok || !resp.data?.login) {
    throw new Error(resp.error || 'GitHub token verification failed.');
  }
  const rawScopes = resp.headers.get('x-oauth-scopes') || '';
  const scopes = rawScopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    login: resp.data.login,
    name: resp.data.name || resp.data.login,
    avatarUrl: resp.data.avatar_url || null,
    scopes,
  };
}

export async function verifyAndSetSessionToken(
  rawToken: string,
  mode: 'oauth' | 'session_pat'
): Promise<GitHubConnectionStatus> {
  const token = rawToken.trim();
  if (!token || token.length < 10) {
    throw new Error('A valid GitHub token is required.');
  }

  const profile = await fetchGitHubUserProfile(token);
  sessionAuth = {
    mode,
    token,
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    scopes: profile.scopes,
    connectedAt: new Date().toISOString(),
  };

  return getGitHubConnectionStatus(true);
}

export function clearSessionToken(): void {
  sessionAuth = null;
}

export async function getGitHubConnectionStatus(refreshProfile = false): Promise<GitHubConnectionStatus> {
  const envToken = process.env.GITHUB_TOKEN?.trim();
  const callbackUrl = getGitHubCallbackUrl();
  const oauthConfigured = isGitHubOAuthConfigured();

  if (envToken) {
    const tokenHash = crypto.createHash('sha256').update(envToken).digest('hex');
    if (refreshProfile || !cachedEnvIdentity || cachedEnvIdentity.tokenHash !== tokenHash) {
      try {
        const profile = await fetchGitHubUserProfile(envToken);
        cachedEnvIdentity = { tokenHash, ...profile };
      } catch {
        cachedEnvIdentity = {
          tokenHash,
          login: null,
          name: null,
          avatarUrl: null,
          scopes: [],
        };
      }
    }

    return {
      connected: true,
      mode: 'env_pat',
      login: cachedEnvIdentity.login,
      name: cachedEnvIdentity.name,
      avatarUrl: cachedEnvIdentity.avatarUrl,
      scopes: cachedEnvIdentity.scopes,
      hasEnvToken: true,
      oauthConfigured,
      callbackUrl,
      connectedAt: null,
    };
  }

  if (sessionAuth) {
    return {
      connected: true,
      mode: sessionAuth.mode,
      login: sessionAuth.login,
      name: sessionAuth.name,
      avatarUrl: sessionAuth.avatarUrl,
      scopes: sessionAuth.scopes,
      hasEnvToken: false,
      oauthConfigured,
      callbackUrl,
      connectedAt: sessionAuth.connectedAt,
    };
  }

  return {
    connected: false,
    mode: 'none',
    login: null,
    name: null,
    avatarUrl: null,
    scopes: [],
    hasEnvToken: false,
    oauthConfigured,
    callbackUrl,
    connectedAt: null,
  };
}

export function createGitHubOAuthUrl(): { url: string; callbackUrl: string } {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in AI Studio Secrets, or connect with a Personal Access Token.'
    );
  }

  const now = Date.now();
  for (const [key, expiresAt] of pendingOAuthStates.entries()) {
    if (expiresAt < now) {
      pendingOAuthStates.delete(key);
    }
  }

  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, now + 10 * 60 * 1000);

  const callbackUrl = getGitHubCallbackUrl();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'repo read:user',
    state,
  });

  return {
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    callbackUrl,
  };
}

export async function exchangeGitHubOAuthCode(
  code: string,
  state: string
): Promise<GitHubConnectionStatus> {
  const expiresAt = pendingOAuthStates.get(state);
  if (!expiresAt || expiresAt < Date.now()) {
    pendingOAuthStates.delete(state);
    throw new Error('OAuth state is invalid or expired. Please restart GitHub connection.');
  }
  pendingOAuthStates.delete(state);

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth credentials missing on server.');
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'PALASH-AI-Platform',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getGitHubCallbackUrl(),
    }),
  });

  const payload = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'GitHub OAuth token exchange failed.');
  }

  return verifyAndSetSessionToken(payload.access_token, 'oauth');
}

export async function inspectGitHubRepository(owner: string, repo: string): Promise<GitHubInspectionResult> {
  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }

  const { token } = resolveGitHubToken();
  const repoResp = await githubFetchJson<{
    private?: boolean;
    default_branch?: string;
    description?: string;
    open_issues_count?: number;
    stargazers_count?: number;
    updated_at?: string;
  }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);

  if (!repoResp.ok || !repoResp.data) {
    const hint =
      repoResp.status === 404 && !token
        ? 'Repository is private or unreachable without GitHub credentials connected.'
        : repoResp.status === 403 && !token
          ? 'Unauthenticated GitHub API rate limit reached. Connect a GitHub token or OAuth above.'
          : repoResp.error;
    return {
      owner,
      repo,
      accessible: false,
      authenticated: Boolean(token),
      visibility: null,
      defaultBranch: null,
      description: null,
      openIssuesCount: null,
      stars: null,
      updatedAt: null,
      branches: [],
      recentCommits: [],
      openPullRequests: [],
      error: hint,
    };
  }

  const [branchesResp, commitsResp, pullsResp] = await Promise.all([
    githubFetchJson<Array<{ name: string; protected: boolean }>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=15`,
      token
    ),
    githubFetchJson<
      Array<{
        sha: string;
        commit: { message: string; author?: { name?: string; date?: string } };
      }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=10`, token),
    githubFetchJson<
      Array<{
        number: number;
        title: string;
        state: string;
        user?: { login?: string };
        head?: { ref?: string };
      }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&per_page=10`, token),
  ]);

  return {
    owner,
    repo,
    accessible: true,
    authenticated: Boolean(token),
    visibility: repoResp.data.private ? 'private' : 'public',
    defaultBranch: repoResp.data.default_branch ?? 'main',
    description: repoResp.data.description ?? null,
    openIssuesCount: repoResp.data.open_issues_count ?? 0,
    stars: repoResp.data.stargazers_count ?? 0,
    updatedAt: repoResp.data.updated_at ?? null,
    branches: (branchesResp.data || []).map((b) => ({ name: b.name, protected: Boolean(b.protected) })),
    recentCommits: (commitsResp.data || []).map((c) => ({
      sha: c.sha.slice(0, 7),
      message: (c.commit.message || '').split('\n')[0],
      author: c.commit.author?.name || 'unknown',
      date: c.commit.author?.date || '',
    })),
    openPullRequests: (pullsResp.data || []).map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      author: p.user?.login || 'unknown',
      branch: p.head?.ref || 'unknown',
    })),
    error: null,
  };
}

export async function listRepositoryFiles(
  owner: string,
  repo: string,
  branch = 'main'
): Promise<Array<{ path: string; type: 'blob' | 'tree'; size: number }>> {
  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }
  const { token } = resolveGitHubToken();
  const resp = await githubFetchJson<{
    tree?: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token
  );
  if (!resp.ok || !resp.data?.tree) {
    throw new Error(resp.error || 'Unable to list repository tree.');
  }
  return resp.data.tree
    .filter((item) => item.type === 'blob')
    .slice(0, 100)
    .map((item) => ({ path: item.path, type: item.type, size: item.size || 0 }));
}

export async function fetchRepositoryFile(
  owner: string,
  repo: string,
  filePath: string,
  branch = 'main'
): Promise<{ path: string; content: string; size: number }> {
  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }
  const cleanPath = filePath.replace(/^\/+/, '');
  if (!cleanPath || cleanPath.includes('..')) {
    throw new Error('Invalid repository file path.');
  }

  const { token } = resolveGitHubToken();
  const encodedPath = cleanPath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  const resp = await githubFetchJson<{
    content?: string;
    encoding?: string;
    size?: number;
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    token
  );

  if (!resp.ok || !resp.data?.content) {
    throw new Error(resp.error || `Unable to read file ${cleanPath}.`);
  }

  const decoded =
    resp.data.encoding === 'base64'
      ? Buffer.from(resp.data.content.replace(/\n/g, ''), 'base64').toString('utf8')
      : resp.data.content;

  return {
    path: cleanPath,
    content: decoded.slice(0, 60_000),
    size: resp.data.size || decoded.length,
  };
}

export function computeGitBlobSha1(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(content).digest('hex');
}

function isSensitiveOrExcludedFile(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  if (base === '.DS_Store') return true;
  if (base.endsWith('.log')) return true;
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) {
    return true;
  }
  return false;
}

export function scanWorkspaceFiles(rootDir: string = process.cwd()): WorkspaceFileEntry[] {
  const normalizedRoot = path.resolve(rootDir);
  const results: WorkspaceFileEntry[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const resolved = path.resolve(currentDir, entry.name);
      if (!resolved.startsWith(normalizedRoot + path.sep)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(resolved);
      } else if (entry.isFile()) {
        const relPosix = path.relative(normalizedRoot, resolved).split(path.sep).join('/');
        if (isSensitiveOrExcludedFile(relPosix)) continue;

        const stat = fs.statSync(resolved);
        if (stat.size > MAX_SCAN_FILE_BYTES) continue;

        const buf = fs.readFileSync(resolved);
        results.push({
          path: relPosix,
          size: buf.length,
          sha: computeGitBlobSha1(buf),
        });
      }
    }
  }

  walk(normalizedRoot);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function encodeBranchPath(branch: string): string {
  return branch
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export async function compareWorkspaceWithGitHub(
  owner: string,
  repo: string,
  branch = 'main'
): Promise<WorkspaceDiffResult> {
  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }
  if (!VALID_BRANCH_NAME.test(branch) || branch.includes('..')) {
    throw new Error('Invalid branch name.');
  }

  const localFiles = scanWorkspaceFiles();
  const { token } = resolveGitHubToken();

  // Check if repository exists first
  const repoResp = await githubFetchJson<{ default_branch?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token
  );
  if (!repoResp.ok) {
    throw new Error(repoResp.error || `Unable to access ${owner}/${repo}.`);
  }

  const refResp = await githubFetchJson<{ object?: { sha?: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeBranchPath(branch)}`,
    token
  );

  // Empty repository or non-existent target branch
  if (!refResp.ok || !refResp.data?.object?.sha) {
    // Check if repository itself is completely empty via commits endpoint
    const commitsProbe = await githubFetchJson<Array<unknown>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=1`,
      token
    );
    const isEmptyRepo = commitsProbe.status === 409;

    const files: WorkspaceDiffFile[] = localFiles.map((lf) => ({
      path: lf.path,
      status: 'added',
      localSize: lf.size,
      remoteSize: null,
      localSha: lf.sha,
      remoteSha: null,
    }));

    return {
      owner,
      repo,
      branch,
      branchExists: false,
      isEmptyRepo,
      remoteHeadSha: null,
      baseTreeSha: null,
      files,
      remoteOnlyCount: 0,
      summary: {
        added: files.length,
        modified: 0,
        unchanged: 0,
        total: files.length,
      },
    };
  }

  const remoteHeadSha = refResp.data.object.sha;
  const commitResp = await githubFetchJson<{ tree?: { sha?: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(remoteHeadSha)}`,
    token
  );
  const baseTreeSha = commitResp.data?.tree?.sha || null;

  const remoteMap = new Map<string, { sha: string; size: number | null }>();
  if (baseTreeSha) {
    const treeResp = await githubFetchJson<{
      tree?: Array<{ path: string; type: string; sha: string; size?: number }>;
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(baseTreeSha)}?recursive=1`,
      token
    );
    for (const entry of treeResp.data?.tree || []) {
      if (entry.type === 'blob') {
        remoteMap.set(entry.path, { sha: entry.sha, size: entry.size ?? null });
      }
    }
  }

  const localPathSet = new Set<string>();
  const files: WorkspaceDiffFile[] = [];
  let added = 0;
  let modified = 0;
  let unchanged = 0;

  for (const lf of localFiles) {
    localPathSet.add(lf.path);
    const remote = remoteMap.get(lf.path);
    if (!remote) {
      added += 1;
      files.push({
        path: lf.path,
        status: 'added',
        localSize: lf.size,
        remoteSize: null,
        localSha: lf.sha,
        remoteSha: null,
      });
    } else if (remote.sha !== lf.sha) {
      modified += 1;
      files.push({
        path: lf.path,
        status: 'modified',
        localSize: lf.size,
        remoteSize: remote.size,
        localSha: lf.sha,
        remoteSha: remote.sha,
      });
    } else {
      unchanged += 1;
      files.push({
        path: lf.path,
        status: 'unchanged',
        localSize: lf.size,
        remoteSize: remote.size,
        localSha: lf.sha,
        remoteSha: remote.sha,
      });
    }
  }

  let remoteOnlyCount = 0;
  for (const rPath of remoteMap.keys()) {
    if (!localPathSet.has(rPath)) {
      remoteOnlyCount += 1;
    }
  }

  return {
    owner,
    repo,
    branch,
    branchExists: true,
    isEmptyRepo: false,
    remoteHeadSha,
    baseTreeSha,
    files,
    remoteOnlyCount,
    summary: {
      added,
      modified,
      unchanged,
      total: files.length,
    },
  };
}

export async function pushWorkspaceToGitHub(input: PushWorkspaceInput): Promise<PushWorkspaceResult> {
  const { owner, repo, targetBranch, commitMessage, filePaths } = input;
  const baseBranch = input.baseBranch?.trim() || 'main';

  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }
  if (!VALID_BRANCH_NAME.test(targetBranch) || targetBranch.includes('..')) {
    throw new Error('Invalid target branch name.');
  }
  if (!VALID_BRANCH_NAME.test(baseBranch) || baseBranch.includes('..')) {
    throw new Error('Invalid base branch name.');
  }
  if (!commitMessage.trim()) {
    throw new Error('Commit message is required.');
  }
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('Select at least one file to push.');
  }

  const { token } = resolveGitHubToken();
  if (!token) {
    throw new Error(
      'GitHub authentication required to push commits. Connect GitHub via OAuth or Personal Access Token first.'
    );
  }

  // Strictly validate requested filePaths against safe workspace scanner allowlist
  const normalizedRoot = path.resolve(process.cwd());
  const allowedFiles = new Map(scanWorkspaceFiles(normalizedRoot).map((f) => [f.path, f]));
  const selectedPaths: string[] = [];
  for (const fp of filePaths) {
    const clean = fp.replace(/^\/+/, '');
    if (allowedFiles.has(clean) && !selectedPaths.includes(clean)) {
      selectedPaths.push(clean);
    }
  }
  if (selectedPaths.length === 0) {
    throw new Error('No valid trackable workspace files matched the requested selection.');
  }

  // 1. Resolve target or base branch ref
  let targetRefExists = false;
  let parentCommitSha: string | null = null;
  let baseTreeSha: string | null = null;

  const targetRefResp = await githubFetchJson<{ object?: { sha?: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeBranchPath(targetBranch)}`,
    token
  );

  if (targetRefResp.ok && targetRefResp.data?.object?.sha) {
    targetRefExists = true;
    parentCommitSha = targetRefResp.data.object.sha;
  } else {
    const baseRefResp = await githubFetchJson<{ object?: { sha?: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeBranchPath(baseBranch)}`,
      token
    );
    if (baseRefResp.ok && baseRefResp.data?.object?.sha) {
      parentCommitSha = baseRefResp.data.object.sha;
    }
  }

  // Handle completely empty repository by initializing the first file via Contents API
  let remainingPaths = [...selectedPaths];
  if (!parentCommitSha) {
    const seedPath = remainingPaths[0];
    const absSeed = path.resolve(normalizedRoot, seedPath);
    if (!absSeed.startsWith(normalizedRoot + path.sep)) {
      throw new Error('Path confinement violation.');
    }
    const seedBuf = fs.readFileSync(absSeed);
    const encodedSeedPath = seedPath.split('/').map((s) => encodeURIComponent(s)).join('/');
    const initResp = await githubFetchJson<{ commit?: { sha?: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedSeedPath}`,
      token,
      {
        method: 'PUT',
        body: {
          message: `chore: initialize repository with ${seedPath}`,
          content: seedBuf.toString('base64'),
          branch: targetBranch,
        },
      }
    );
    if (!initResp.ok || !initResp.data?.commit?.sha) {
      throw new Error(initResp.error || 'Failed to initialize empty GitHub repository.');
    }
    targetRefExists = true;
    parentCommitSha = initResp.data.commit.sha;
    remainingPaths = remainingPaths.slice(1);
    if (remainingPaths.length === 0) {
      return {
        owner,
        repo,
        branch: targetBranch,
        baseBranch,
        commitSha: parentCommitSha,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${parentCommitSha}`,
        filesPushed: 1,
        prNumber: null,
        prUrl: null,
      };
    }
  }

  // Fetch base tree SHA from parent commit
  const parentCommitResp = await githubFetchJson<{ tree?: { sha?: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(parentCommitSha)}`,
    token
  );
  if (!parentCommitResp.ok || !parentCommitResp.data?.tree?.sha) {
    throw new Error(parentCommitResp.error || 'Unable to resolve parent commit tree on GitHub.');
  }
  baseTreeSha = parentCommitResp.data.tree.sha;

  // 2. Create Git blobs in batches of 5
  const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
  const batchSize = 5;
  for (let i = 0; i < remainingPaths.length; i += batchSize) {
    const chunk = remainingPaths.slice(i, i + batchSize);
    const created = await Promise.all(
      chunk.map(async (relPath) => {
        const absPath = path.resolve(normalizedRoot, relPath);
        if (!absPath.startsWith(normalizedRoot + path.sep)) {
          throw new Error(`Invalid workspace path: ${relPath}`);
        }
        const buf = fs.readFileSync(absPath);
        const blobResp = await githubFetchJson<{ sha?: string }>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
          token,
          {
            method: 'POST',
            body: {
              content: buf.toString('base64'),
              encoding: 'base64',
            },
          }
        );
        if (!blobResp.ok || !blobResp.data?.sha) {
          throw new Error(blobResp.error || `Failed creating Git blob for ${relPath}`);
        }
        return {
          path: relPath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blobResp.data.sha,
        };
      })
    );
    treeEntries.push(...created);
  }

  // 3. Create new Git Tree
  const treeResp = await githubFetchJson<{ sha?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    token,
    {
      method: 'POST',
      body: {
        base_tree: baseTreeSha,
        tree: treeEntries,
      },
    }
  );
  if (!treeResp.ok || !treeResp.data?.sha) {
    throw new Error(treeResp.error || 'Failed to create GitHub commit tree.');
  }

  // 4. Create Commit
  const commitResp = await githubFetchJson<{ sha?: string; html_url?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    token,
    {
      method: 'POST',
      body: {
        message: commitMessage.trim(),
        tree: treeResp.data.sha,
        parents: [parentCommitSha],
      },
    }
  );
  if (!commitResp.ok || !commitResp.data?.sha) {
    throw new Error(commitResp.error || 'Failed to create GitHub commit.');
  }
  const commitSha = commitResp.data.sha;
  const commitUrl = `https://github.com/${owner}/${repo}/commit/${commitSha}`;

  // 5. Update or Create Branch Ref
  if (targetRefExists) {
    const updateResp = await githubFetchJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeBranchPath(targetBranch)}`,
      token,
      {
        method: 'PATCH',
        body: {
          sha: commitSha,
          force: false,
        },
      }
    );
    if (!updateResp.ok) {
      throw new Error(updateResp.error || `Failed updating branch ${targetBranch}.`);
    }
  } else {
    const createRefResp = await githubFetchJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
      token,
      {
        method: 'POST',
        body: {
          ref: `refs/heads/${targetBranch}`,
          sha: commitSha,
        },
      }
    );
    if (!createRefResp.ok) {
      throw new Error(createRefResp.error || `Failed creating branch ${targetBranch}.`);
    }
  }

  // 6. Optionally open Pull Request when pushing to a non-base branch
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  if (input.createPullRequest && targetBranch !== baseBranch) {
    const prResp = await githubFetchJson<{ number?: number; html_url?: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      token,
      {
        method: 'POST',
        body: {
          title: input.prTitle?.trim() || commitMessage.trim(),
          head: targetBranch,
          base: baseBranch,
          body:
            input.prBody?.trim() ||
            `Pushed ${selectedPaths.length} file(s) from PALASH AI Autonomous Command Center.`,
        },
      }
    );
    if (prResp.ok && prResp.data?.html_url) {
      prNumber = prResp.data.number ?? null;
      prUrl = prResp.data.html_url;
    } else {
      // Check if an open PR already exists for this head branch
      const existingPrs = await githubFetchJson<Array<{ number: number; html_url: string }>>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&head=${encodeURIComponent(`${owner}:${targetBranch}`)}`,
        token
      );
      if (existingPrs.ok && existingPrs.data && existingPrs.data[0]) {
        prNumber = existingPrs.data[0].number;
        prUrl = existingPrs.data[0].html_url;
      }
    }
  }

  return {
    owner,
    repo,
    branch: targetBranch,
    baseBranch,
    commitSha,
    commitUrl,
    filesPushed: selectedPaths.length,
    prNumber,
    prUrl,
  };
}

export async function syncLocalGitRemote(owner: string, repo: string): Promise<{
  gitAvailable: boolean;
  initialized: boolean;
  remoteUrl: string;
}> {
  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }
  const remoteUrl = `https://github.com/${owner}/${repo}.git`;
  const cwd = process.cwd();
  const safeArgs = ['-c', `safe.directory=${cwd}`];

  try {
    await execFileAsync('git', ['--version'], { cwd });
  } catch {
    return { gitAvailable: false, initialized: false, remoteUrl };
  }

  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    await execFileAsync('git', [...safeArgs, 'init', '-b', 'main'], { cwd });
  }

  try {
    await execFileAsync('git', [...safeArgs, 'remote', 'get-url', 'origin'], { cwd });
    await execFileAsync('git', [...safeArgs, 'remote', 'set-url', 'origin', remoteUrl], { cwd });
  } catch {
    await execFileAsync('git', [...safeArgs, 'remote', 'add', 'origin', remoteUrl], { cwd });
  }

  return { gitAvailable: true, initialized: true, remoteUrl };
}
