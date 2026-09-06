import type { Finding, ScannedFile } from "@/types";
import {
  capFindings,
  evidenceForLine,
  findLine,
  firstEvidence,
  isEnvExamplePath,
  isLockfilePath,
  isReadmePath,
  isWorkflowPath,
  makeFindingId,
} from "@/lib/checks/helpers";
import { environmentReads } from "@/lib/checks/missing-env";

/**
 * Absence is the hardest thing to report honestly: the scanner downloads a
 * subset of the repository, so "not in the files we read" is not the same as
 * "not in the repository". Every presence test below runs against
 * `repositoryPaths` — the full git tree — while content tests run against the
 * files actually fetched.
 */
export function setupGaps(files: ScannedFile[], repositoryPaths: string[] = []) {
  const paths = repositoryPaths.length > 0 ? repositoryPaths : files.map((file) => file.path);
  const packageFile = files.find((file) => file.path === "package.json");
  const makefile = files.find((file) => /^makefile$/i.test(file.path));
  const manifest = packageFile ?? files.find((file) => /^(pyproject\.toml|requirements\.txt)$/i.test(file.path));
  const anchor = manifest ?? makefile ?? files[0];
  const findings: Finding[] = [];

  if (!anchor) return capFindings("setup-gaps", findings);

  if (manifest && !paths.some(isLockfilePath)) {
    findings.push(absenceFinding(
      "no-lockfile",
      "No lockfile found",
      "This project declares a package manifest but the repository contains no recognised lockfile, so installs are not reproducible.",
      firstEvidence(manifest),
    ));
  }

  const reads = environmentReads(files.filter(isApplicationSource));
  if (reads.length > 0 && !paths.some(isEnvExamplePath)) {
    const source = reads[0];
    findings.push({
      id: makeFindingId("setup-gaps", source.file.path, source.line, "no-env-example"),
      severity: "medium",
      title: "No environment example file",
      detail: "The application reads environment variables but the repository contains no .env.example or .env.sample.",
      evidence: evidenceForLine(source.file, source.line),
    });
  }

  if ((packageFile || makefile) && !hasTestCommand(packageFile, makefile)) {
    const host = packageFile ?? makefile!;
    findings.push(absenceFinding(
      "no-test-command",
      "No test command found",
      "Neither package.json nor the Makefile declares a test command, so there is no agreed way to verify a change.",
      packageFile ? findLine(packageFile, /"scripts"\s*:/) : firstEvidence(host),
    ));
  }

  if (!paths.some(isWorkflowPath)) {
    findings.push(absenceFinding(
      "no-ci",
      "No CI workflow found",
      "The repository contains no GitHub Actions workflow under .github/workflows/, so nothing verifies a push.",
      firstEvidence(anchor),
    ));
  }

  if (!paths.some(isReadmePath)) {
    findings.push(absenceFinding(
      "no-readme",
      "No README found",
      "The repository has no root README, so there is no stated entry point for a new reader.",
      firstEvidence(anchor),
    ));
  }

  return capFindings("setup-gaps", findings);
}

function isApplicationSource(file: ScannedFile): boolean {
  return /^(src|app|lib|pages|components)\/.*\.(ts|tsx|js|jsx|py|go|rs)$/i.test(file.path);
}

function hasTestCommand(packageFile?: ScannedFile, makefile?: ScannedFile): boolean {
  if (packageFile) {
    try {
      const parsed = JSON.parse(packageFile.content) as { scripts?: Record<string, unknown> };
      if (Object.keys(parsed.scripts ?? {}).some((name) => name === "test" || /^test[:.-]/.test(name))) {
        return true;
      }
    } catch {
      // A malformed manifest cannot establish a test command.
    }
  }

  return Boolean(makefile && /^(test|test[-_.][A-Za-z0-9_.-]*)\s*:(?!=)/m.test(makefile.content));
}

function absenceFinding(
  label: string,
  title: string,
  detail: string,
  evidence: ReturnType<typeof firstEvidence>,
): Finding {
  return {
    id: makeFindingId("setup-gaps", evidence.path, evidence.line, label),
    severity: "medium",
    title,
    detail,
    evidence,
  };
}
