import type {
  CheckId,
  CheckResult,
  Evidence,
  Finding,
  ScannedFile,
  Severity,
  SeverityCounts,
} from "@/types";

const SOURCE_ROOTS = [
  "src/", "src/main/", "app/", "lib/", "pages/", "components/", "cmd/", "internal/",
  "scripts/", "server/", "api/", "core/", "packages/",
];
const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "go", "rs", "ps1", "sh", "bash", "java", "rb",
  "php", "c", "h", "cpp", "cs", "kt", "swift", "vue", "svelte", "mjs", "cjs", "sql",
  "yml", "yaml",
]);
const EMPTY_COUNTS: SeverityCounts = { high: 0, medium: 0, low: 0 };

export function capFindings(id: CheckId, findings: Finding[]): CheckResult {
  const ranked = [...findings].sort(compareFindings);
  const visible = ranked.slice(0, 8);
  const omittedBySeverity = ranked.slice(8).reduce<SeverityCounts>(
    (counts, finding) => ({
      ...counts,
      [finding.severity]: counts[finding.severity] + 1,
    }),
    { ...EMPTY_COUNTS },
  );

  return { id, findings: visible, omittedBySeverity };
}

export function evidenceForLine(file: ScannedFile, line: number): Evidence {
  return {
    path: file.path,
    line,
    snippet: file.content.split(/\r?\n/)[line - 1]?.trim() || undefined,
  };
}

export function firstEvidence(file: ScannedFile): Evidence {
  return evidenceForLine(file, 1);
}

export function findLine(file: ScannedFile, pattern: RegExp): Evidence {
  const lineIndex = file.content.split(/\r?\n/).findIndex((line) => {
    pattern.lastIndex = 0;
    return pattern.test(line);
  });
  return evidenceForLine(file, Math.max(1, lineIndex + 1));
}

export function isReadme(file: ScannedFile): boolean {
  return /^README[^/]*$/i.test(file.path);
}

export function isEnvExample(file: ScannedFile): boolean {
  return /(^|\/)\.env\.(example|sample)$/i.test(file.path);
}

export function isSourceFile(file: ScannedFile): boolean {
  const extension = file.path.split(".").at(-1)?.toLowerCase();
  if (!extension || !SOURCE_EXTENSIONS.has(extension)) return false;
  return !file.path.includes("/") || SOURCE_ROOTS.some((root) => file.path.startsWith(root));
}

export function makeFindingId(
  check: CheckId,
  path: string,
  line: number | undefined,
  label: string,
): string {
  const suffix = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${check}:${path}:${line ?? 0}:${suffix}`;
}

export function countBySeverity(findings: Finding[]): SeverityCounts {
  return findings.reduce<SeverityCounts>(
    (counts, finding) => ({
      ...counts,
      [finding.severity]: counts[finding.severity] + 1,
    }),
    { ...EMPTY_COUNTS },
  );
}

function compareFindings(left: Finding, right: Finding): number {
  const severityDifference = severityRank(left.severity) - severityRank(right.severity);
  if (severityDifference) return severityDifference;

  const pathDifference = left.evidence.path.localeCompare(right.evidence.path);
  if (pathDifference) return pathDifference;

  return (left.evidence.line ?? 0) - (right.evidence.line ?? 0);
}

function severityRank(severity: Severity): number {
  return { high: 0, medium: 1, low: 2 }[severity];
}
