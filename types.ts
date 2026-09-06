export type Severity = "high" | "medium" | "low";

export type Evidence = {
  path: string;
  line?: number;
  snippet?: string;
};

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Evidence;
};

export type CheckId =
  | "command-drift"
  | "missing-env"
  | "setup-gaps"
  | "unfinished";

export type SeverityCounts = Record<Severity, number>;

export type CheckResult = {
  id: CheckId;
  findings: Finding[];
  omittedBySeverity: SeverityCounts;
};

export type Repository = {
  owner: string;
  name: string;
  url: string;
  description: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  language: string | null;
  openIssueCount: number;
};

export type ScannedFile = {
  path: string;
  content: string;
};

export type TreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
};

export type ScanSnapshot = {
  repository: Repository;
  files: ScannedFile[];
  tree: TreeEntry[];
  latestCommit: LatestCommit | null;
  candidateFileCount: number;
  scannedSourceFileCount: number;
  isPartial: boolean;
};

export type LatestCommit = {
  message: string;
  committedAt: string | null;
};

export type DetectedCommand = {
  kind: "dev" | "build" | "test" | "lint";
  command: string;
  source: Evidence;
};

export type TopLevelDirectory = {
  name: string;
  role: string;
};

export type RepoMap = {
  languages: Array<{ name: string; fileCount: number }>;
  stack: string[];
  commands: DetectedCommand[];
  entrypoints: string[];
  directories: TopLevelDirectory[];
  daysSinceLastCommit: number | null;
  lastCommitMessage: string | null;
  openIssueCount: number;
  scannedFileCount: number;
  candidateFileCount: number;
  isPartial: boolean;
};

export type NextTask = {
  title: string;
  why: string;
  codexPrompt: string;
};

export type TaskBrief = {
  summary: string;
  stalledBecause: string;
  tasks: [NextTask, NextTask, NextTask];
};

export type ScanResult = {
  repository: Repository;
  map: RepoMap;
  findings: Finding[];
  checks: CheckResult[];
  severityCounts: SeverityCounts;
  agentsMd: string;
  taskBrief: TaskBrief | null;
};

export type ScanErrorCode =
  | "INVALID_URL"
  | "REPOSITORY_UNAVAILABLE"
  | "EMPTY_REPOSITORY"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR";

export type ScanFailure = {
  error: {
    code: ScanErrorCode;
    message: string;
  };
};
