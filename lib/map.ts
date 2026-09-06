import type {
  DetectedCommand,
  Evidence,
  RepoMap,
  ScanSnapshot,
  ScannedFile,
  TreeEntry,
} from "@/types";

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "vendor",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  ps1: "PowerShell",
  sh: "Shell",
  bash: "Shell",
  java: "Java",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  c: "C",
  h: "C",
  cpp: "C++",
  hpp: "C++",
  swift: "Swift",
  kt: "Kotlin",
  kts: "Kotlin",
  vue: "Vue",
  svelte: "Svelte",
  mjs: "JavaScript",
  cjs: "JavaScript",
  sql: "SQL",
  yml: "YAML",
  yaml: "YAML",
};

const DIRECTORY_ROLES: Record<string, string> = {
  ".github": "GitHub workflows and repository automation.",
  api: "Server-side API handlers.",
  app: "Application routes and user interface.",
  assets: "Project assets used by the application.",
  cmd: "Command-line application entrypoints.",
  components: "Reusable user-interface components.",
  config: "Project configuration.",
  docs: "Project documentation.",
  examples: "Example applications or usage.",
  lib: "Shared application code.",
  pages: "Page routes and user interface.",
  public: "Static assets served directly.",
  scripts: "Development and automation scripts.",
  src: "Primary application source code.",
  test: "Automated tests.",
  tests: "Automated tests.",
};

export function deriveRepoMap(snapshot: ScanSnapshot): RepoMap {
  const relevantTree = snapshot.tree.filter(
    (entry) => entry.type === "blob" && !isExcluded(entry.path),
  );
  const packageFile = snapshot.files.find((file) => file.path === "package.json");
  const makefile = snapshot.files.find((file) => /^makefile$/i.test(file.path));
  const committedAt = snapshot.latestCommit?.committedAt ?? snapshot.repository.pushedAt;

  return {
    languages: countLanguages(relevantTree),
    stack: detectStack(relevantTree, packageFile, snapshot.repository.language),
    commands: detectCommands(packageFile, makefile),
    entrypoints: detectEntrypoints(relevantTree),
    directories: topLevelDirectories(relevantTree),
    daysSinceLastCommit: daysSince(committedAt),
    lastCommitMessage: snapshot.latestCommit?.message ?? null,
    openIssueCount: snapshot.repository.openIssueCount,
    scannedFileCount: snapshot.scannedSourceFileCount,
    candidateFileCount: snapshot.candidateFileCount,
    isPartial: snapshot.isPartial,
  };
}

function countLanguages(tree: TreeEntry[]): Array<{ name: string; fileCount: number }> {
  const counts = new Map<string, number>();

  for (const entry of tree) {
    const extension = entry.path.split(".").at(-1)?.toLowerCase();
    const language = extension ? LANGUAGE_BY_EXTENSION[extension] : undefined;
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((left, right) => right.fileCount - left.fileCount || left.name.localeCompare(right.name));
}

function detectStack(
  tree: TreeEntry[],
  packageFile: ScannedFile | undefined,
  primaryLanguage: string | null,
): string[] {
  const stack = new Set<string>();
  const paths = new Set(tree.map((entry) => entry.path.toLowerCase()));
  const packageNames = packageFile ? packageDependencyNames(packageFile.content) : new Set<string>();

  if (packageFile) stack.add("Node.js");
  if (packageNames.has("next")) stack.add("Next.js");
  if (packageNames.has("react")) stack.add("React");
  if (paths.has("tsconfig.json") || tree.some((entry) => /\.(ts|tsx)$/.test(entry.path))) {
    stack.add("TypeScript");
  }
  if (paths.has("pyproject.toml") || tree.some((entry) => entry.path.endsWith(".py"))) stack.add("Python");
  if (paths.has("go.mod") || tree.some((entry) => entry.path.endsWith(".go"))) stack.add("Go");
  if (paths.has("cargo.toml") || tree.some((entry) => entry.path.endsWith(".rs"))) stack.add("Rust");
  if (primaryLanguage) stack.add(primaryLanguage);

  return [...stack];
}

function detectCommands(
  packageFile: ScannedFile | undefined,
  makefile: ScannedFile | undefined,
): DetectedCommand[] {
  const commands: DetectedCommand[] = [];
  const packageScripts = packageFile ? readPackageScripts(packageFile.content) : {};

  for (const kind of ["dev", "build", "test", "lint"] as const) {
    if (packageScripts[kind] && packageFile) {
      commands.push({
        kind,
        command: `npm run ${kind}`,
        source: evidenceForText(packageFile, `"${kind}"`),
      });
    }
  }

  if (makefile) {
    for (const kind of ["dev", "build", "test", "lint"] as const) {
      const target = new RegExp(`^${kind}\\s*:(?!=)`, "m");
      if (target.test(makefile.content)) {
        commands.push({
          kind,
          command: `make ${kind}`,
          source: evidenceForText(makefile, target),
        });
      }
    }
  }

  return commands;
}

function detectEntrypoints(tree: TreeEntry[]): string[] {
  const entrypoints = tree
    .map((entry) => entry.path)
    .filter((path) => {
      return (
        /^app\/page\.(js|jsx|tsx)$/.test(path) ||
        /^pages\/index\.(js|jsx|tsx)$/.test(path) ||
        /^(src\/)?(main|index)\.(ts|tsx|js|jsx|py)$/.test(path) ||
        /^cmd\/[^/]+\/main\.go$/.test(path) ||
        path === "src/main.rs"
      );
    });

  return entrypoints.sort();
}

function topLevelDirectories(tree: TreeEntry[]) {
  const names = new Set(
    tree
      .map((entry) => entry.path.split("/")[0])
      .filter((name, index, parts) => parts[index] !== undefined && tree.some((entry) => entry.path.startsWith(`${name}/`))),
  );

  return [...names]
    .sort()
    .map((name) => ({ name, role: DIRECTORY_ROLES[name.toLowerCase()] ?? "Project files and source code." }));
}

function readPackageScripts(content: string): Record<string, string> {
  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
    return Object.fromEntries(
      Object.entries(parsed.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function packageDependencyNames(content: string): Set<string> {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    return new Set(
      sections.flatMap((section) => {
        const dependencies = parsed[section];
        return dependencies && typeof dependencies === "object" ? Object.keys(dependencies) : [];
      }),
    );
  } catch {
    return new Set();
  }
}

function evidenceForText(file: ScannedFile, text: string | RegExp): Evidence {
  const lines = file.content.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => {
    if (typeof text === "string") return line.includes(text);
    text.lastIndex = 0;
    return text.test(line);
  });
  const line = Math.max(1, lineIndex + 1);
  return { path: file.path, line, snippet: lines[line - 1]?.trim() || undefined };
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
}

function isExcluded(path: string): boolean {
  return path.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}
