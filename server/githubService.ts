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

const VALID_GITHUB_SEGMENT = /^[a-zA-Z0-9_.-]+$/;

async function githubFetchJson<T>(apiPath: string, token?: string): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const url = new URL(`https://api.github.com${apiPath}`);
  if (url.hostname !== 'api.github.com') {
    throw new Error('SSRF guard: invalid GitHub API host');
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PALASH-AI-Platform',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    headers,
    // A hung GitHub call would otherwise block the Express handler for minutes.
    signal: AbortSignal.timeout(Number(process.env.GITHUB_TIMEOUT_MS || 15_000)),
  });
  if (!res.ok) {
    let msg = `GitHub API responded HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody?.message) msg = `${msg}: ${errBody.message}`;
    } catch {
      // ignore json parse issue
    }
    return { ok: false, status: res.status, data: null, error: msg };
  }
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data, error: null };
}

export async function inspectGitHubRepository(owner: string, repo: string): Promise<GitHubInspectionResult> {
  if (!VALID_GITHUB_SEGMENT.test(owner) || !VALID_GITHUB_SEGMENT.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name.');
  }

  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
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
        ? 'Repository is private or unreachable without GITHUB_TOKEN configured in Settings > Secrets.'
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
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=10`,
      token
    ),
    githubFetchJson<
      Array<{
        sha: string;
        commit: { message: string; author?: { name?: string; date?: string } };
      }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=8`, token),
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
  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
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
    .slice(0, 60)
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

  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
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

