import type {
  LatestCommit,
  Repository,
  ScanErrorCode,
  ScanSnapshot,
  ScannedFile,
  TreeEntry,
} from "@/types";

const GITHUB_API_URL = "https://api.github.com";
const RAW_GITHUB_URL = "https://raw.githubusercontent.com";
const SCAN_TIMEOUT_MS = 20_000;
const MAX_FILE_SIZE_BYTES = 100 * 1024;
const SOURCE_LIMIT = 48;
const RAW_FETCH_CONCURRENCY = 12;

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "vendor",
]);

const SOURCE_DIRECTORIES = [
  "src/",
  "src/main/",
  "app/",
  "lib/",
  "pages/",
  "components/",
  "cmd/",
  "internal/",
  "scripts/",
  "server/",
  "api/",
  "core/",
  "packages/",
];
const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "go", "rs", "ps1", "sh", "bash", "java", "rb",
  "php", "c", "h", "cpp", "cs", "kt", "swift", "vue", "svelte", "mjs", "cjs", "sql",
  "yml", "yaml",
]);
const DEADLINE_PROMISES = new WeakMap<AbortSignal, Promise<never>>();
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "gemfile.lock",
  "mix.lock",
  "podfile.lock",
  "gradle.lockfile",
  ".terraform.lock.hcl",
  "go.sum",
]);

type ParsedRepository = {
  owner: string;
  name: string;
};

type CandidateSelection = {
  entries: TreeEntry[];
  sourceCandidateCount: number;
};

type GitHubRepositoryResponse = {
  description: string | null;
  default_branch: string;
  pushed_at: string | null;
  open_issues_count: number;
  language: string | null;
};

type GitHubTreeResponse = {
  sha: string;
  tree: Array<{
    path: string;
    type: "blob" | "tree" | "commit";
    size?: number;
  }>;
};

type GitHubCommitResponse = Array<{
  sha?: string;
  commit?: {
    message?: string;
    author?: { date?: string | null };
    committer?: { date?: string | null };
  };
}>;

export class GitHubScanError extends Error {
  constructor(
    public readonly code: ScanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitHubScanError";
  }
}

export function parseGitHubRepoUrl(input: string): ParsedRepository | null {
  const value = input.trim();
  if (!value) return null;

  const sshMatch = value.match(
    /^(?:ssh:\/\/)?(?:git@)?github\.com[:/]([^/\s]+)\/([^/?#\s]+)(?:[/?#].*)?$/i,
  );
  if (sshMatch) return normalizeRepository(sshMatch[1], sshMatch[2]);

  const urlValue = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;

  try {
    const url = new URL(urlValue);
    const hostname = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);

    if (hostname === "github.com" || hostname === "www.github.com") {
      return normalizeRepository(parts[0], parts[1]);
    }

    if (hostname === "raw.githubusercontent.com") {
      return normalizeRepository(parts[0], parts[1]);
    }
  } catch {
    return null;
  }

  return null;
}

export async function fetchScanSnapshot(input: string): Promise<ScanSnapshot> {
  const parsed = parseGitHubRepoUrl(input);
  if (!parsed) {
    throw new GitHubScanError(
      "INVALID_URL",
      "Enter a valid GitHub repository URL, such as https://github.com/owner/repo.",
    );
  }

  const controller = new AbortController();
  let deadlineExceeded = false;
  const timeout = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort();
  }, SCAN_TIMEOUT_MS);

  try {
    const apiPath = `${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`;
    const repositoryData = await fetchGitHubJson<GitHubRepositoryResponse>(
      `${GITHUB_API_URL}/repos/${apiPath}`,
      controller.signal,
    );

    const repository: Repository = {
      owner: parsed.owner,
      name: parsed.name,
      url: `https://github.com/${parsed.owner}/${parsed.name}`,
      description: repositoryData.description,
      defaultBranch: repositoryData.default_branch,
      pushedAt: repositoryData.pushed_at,
      language: repositoryData.language,
      openIssueCount: repositoryData.open_issues_count,
    };

    const branch = encodeURIComponent(repository.defaultBranch);
    const [treeResult, commitsResult] = await Promise.allSettled([
      fetchGitHubJson<GitHubTreeResponse>(
        `${GITHUB_API_URL}/repos/${apiPath}/git/trees/${branch}?recursive=1`,
        controller.signal,
        true,
      ),
      fetchGitHubJson<GitHubCommitResponse>(
        `${GITHUB_API_URL}/repos/${apiPath}/commits?per_page=20`,
        controller.signal,
      ),
    ]);

    if (treeResult.status === "rejected") {
      if (!isDeadlineFailure(treeResult.reason, deadlineExceeded)) {
        throw normalizeError(treeResult.reason);
      }

      return {
        repository,
        tree: [],
        files: [],
        latestCommit:
          commitsResult.status === "fulfilled" ? toLatestCommit(commitsResult.value) : null,
        candidateFileCount: 0,
        scannedSourceFileCount: 0,
        isPartial: true,
      };
    }

    if (commitsResult.status === "rejected" && !isDeadlineFailure(commitsResult.reason, deadlineExceeded)) {
      throw normalizeError(commitsResult.reason);
    }

    const treeData = treeResult.value;
    const commitsData = commitsResult.status === "fulfilled" ? commitsResult.value : [];

    const tree: TreeEntry[] = treeData.tree.map((entry) => ({
      path: entry.path,
      type: entry.type,
      size: entry.size,
    }));

    if (tree.length === 0) {
      throw new GitHubScanError(
        "EMPTY_REPOSITORY",
        "This repository is empty, so there are no files to scan.",
      );
    }

    const candidates = selectCandidateFiles(tree);
    const files = await fetchCandidateFiles(
      parsed,
      commitsData[0]?.sha ?? repository.defaultBranch,
      candidates.entries,
      controller.signal,
    );

    return {
      repository,
      tree,
      files,
      latestCommit: toLatestCommit(commitsData),
      candidateFileCount: candidates.sourceCandidateCount,
      scannedSourceFileCount: files.filter((file) => isSourceFile(file.path)).length,
      isPartial:
        deadlineExceeded ||
        commitsResult.status === "rejected" ||
        files.length < candidates.entries.length,
    };
  } catch (error) {
    if (error instanceof GitHubScanError) throw error;
    if (isAbortError(error)) {
      throw new GitHubScanError(
        "UPSTREAM_ERROR",
        "GitHub took too long to respond. Please try scanning again.",
      );
    }
    throw new GitHubScanError(
      "UPSTREAM_ERROR",
      "GitHub could not be reached. Please try scanning again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRepository(owner?: string, name?: string): ParsedRepository | null {
  if (!owner || !name) return null;
  let cleanOwner: string;
  let cleanName: string;

  try {
    cleanOwner = decodeURIComponent(owner).trim();
    cleanName = decodeURIComponent(name).replace(/\.git$/i, "").trim();
  } catch {
    return null;
  }

  if (!cleanOwner || !cleanName || !/^[\w.-]+$/.test(cleanOwner) || !/^[\w.-]+$/.test(cleanName)) {
    return null;
  }

  return { owner: cleanOwner, name: cleanName };
}

async function fetchGitHubJson<T>(
  url: string,
  signal: AbortSignal,
  isTreeRequest = false,
): Promise<T> {
  const response = await awaitUntilDeadline(
    fetch(url, {
      headers: githubHeaders(),
      signal,
      cache: "no-store",
    }),
    signal,
  );

  if (!response.ok) {
    throw responseError(response.status, response.headers, isTreeRequest);
  }

  return awaitUntilDeadline(response.json() as Promise<T>, signal);
}

function responseError(
  status: number,
  headers: Headers,
  isTreeRequest: boolean,
): GitHubScanError {
  if (status === 409 && isTreeRequest) {
    return new GitHubScanError(
      "EMPTY_REPOSITORY",
      "This repository is empty, so there are no files to scan.",
    );
  }

  if (status === 429 || (status === 403 && headers.get("x-ratelimit-remaining") === "0")) {
    return new GitHubScanError(
      "RATE_LIMITED",
      "GitHub's request limit has been reached. Try again shortly or configure GITHUB_TOKEN.",
    );
  }

  if (status === 404) {
    return new GitHubScanError(
      "REPOSITORY_UNAVAILABLE",
      "This repository was not found or is private. Cold Start can only scan public GitHub repositories.",
    );
  }

  return new GitHubScanError(
    "UPSTREAM_ERROR",
    "GitHub could not complete this scan. Please try again.",
  );
}

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "cold-start-repository-scanner",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function selectCandidateFiles(tree: TreeEntry[]): CandidateSelection {
  const selected = new Map<string, TreeEntry>();
  const sourceFiles: TreeEntry[] = [];

  for (const entry of tree) {
    if (entry.type !== "blob" || isExcluded(entry.path) || isTooLarge(entry)) continue;

    if (isRootScanFile(entry.path) || isWorkflow(entry.path) || isLockfile(entry.path)) {
      selected.set(entry.path, entry);
      continue;
    }

    if (isSourceFile(entry.path)) sourceFiles.push(entry);
  }

  const selectedSources = sourceFiles.sort(compareSourcePaths).slice(0, SOURCE_LIMIT);
  for (const entry of selectedSources) {
    selected.set(entry.path, entry);
  }

  return {
    entries: [...selected.values()].sort((a, b) => a.path.localeCompare(b.path)),
    sourceCandidateCount: selectedSources.length,
  };
}

async function fetchCandidateFiles(
  repository: ParsedRepository,
  ref: string,
  candidates: TreeEntry[],
  signal: AbortSignal,
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < candidates.length) {
      const entry = candidates[nextIndex++];
      const file = await fetchCandidateFile(repository, ref, entry, signal);
      if (file) files.push(file);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(RAW_FETCH_CONCURRENCY, candidates.length) }, () => worker()),
  );

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function fetchCandidateFile(
  repository: ParsedRepository,
  ref: string,
  entry: TreeEntry,
  signal: AbortSignal,
): Promise<ScannedFile | null> {
  const path = entry.path.split("/").map(encodeURIComponent).join("/");
  const url = `${RAW_GITHUB_URL}/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${encodeURIComponent(ref)}/${path}`;

  try {
    const response = await awaitUntilDeadline(
      fetch(url, {
        headers: githubHeaders(),
        signal,
        cache: "no-store",
      }),
      signal,
    );
    if (!response.ok) return null;

    const content = await awaitUntilDeadline(response.text(), signal);
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_SIZE_BYTES) return null;
    return { path: entry.path, content };
  } catch {
    return null;
  }
}

function isRootScanFile(path: string): boolean {
  if (path.includes("/")) return false;
  const lower = path.toLowerCase();
  return (
    /^readme[^/]*$/i.test(path) ||
    [
      "package.json",
      ".nvmrc",
      ".env.example",
      ".env.sample",
      "makefile",
      "pyproject.toml",
      "requirements.txt",
    ].includes(lower)
  );
}

function isWorkflow(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}

function isLockfile(path: string): boolean {
  const filename = path.split("/").at(-1)?.toLowerCase();
  return Boolean(filename && (LOCKFILE_NAMES.has(filename) || filename.endsWith(".lock")));
}

function isSourceFile(path: string): boolean {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (!extension || !SOURCE_EXTENSIONS.has(extension)) return false;
  return !path.includes("/") || SOURCE_DIRECTORIES.some((directory) => path.startsWith(directory));
}

function isExcluded(path: string): boolean {
  return path.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

function isTooLarge(entry: TreeEntry): boolean {
  return typeof entry.size === "number" && entry.size > MAX_FILE_SIZE_BYTES;
}

function compareSourcePaths(left: TreeEntry, right: TreeEntry): number {
  const depthDifference = left.path.split("/").length - right.path.split("/").length;
  return depthDifference || left.path.localeCompare(right.path);
}

function toLatestCommit(commits: GitHubCommitResponse): LatestCommit | null {
  const latest = commits[0]?.commit;
  if (!latest?.message) return null;

  return {
    message: latest.message.split("\n")[0],
    committedAt: latest.committer?.date ?? latest.author?.date ?? null,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function awaitUntilDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([promise, deadlinePromise(signal)]);
}

function deadlinePromise(signal: AbortSignal): Promise<never> {
  const existing = DEADLINE_PROMISES.get(signal);
  if (existing) return existing;

  const deadline = new Promise<never>((_, reject) => {
    const rejectForDeadline = () => reject(new DOMException("Scan deadline exceeded", "AbortError"));
    if (signal.aborted) {
      rejectForDeadline();
      return;
    }
    signal.addEventListener("abort", rejectForDeadline, { once: true });
  });
  DEADLINE_PROMISES.set(signal, deadline);
  return deadline;
}

function isDeadlineFailure(error: unknown, deadlineExceeded: boolean): boolean {
  return deadlineExceeded && isAbortError(error);
}

function normalizeError(error: unknown): GitHubScanError {
  if (error instanceof GitHubScanError) return error;
  if (isAbortError(error)) {
    return new GitHubScanError(
      "UPSTREAM_ERROR",
      "GitHub took too long to respond. Please try scanning again.",
    );
  }
  return new GitHubScanError(
    "UPSTREAM_ERROR",
    "GitHub could not be reached. Please try scanning again.",
  );
}
