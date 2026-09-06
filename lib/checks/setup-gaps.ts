import type { Finding, ScannedFile } from "@/types";
import {
  capFindings,
  firstEvidence,
  isEnvExample,
  isReadme,
  makeFindingId,
} from "@/lib/checks/helpers";
import { environmentReads } from "@/lib/checks/missing-env";

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

export function setupGaps(files: ScannedFile[]) {
  const packageFile = files.find((file) => file.path === "package.json");
  const makefile = files.find((file) => /^makefile$/i.test(file.path));
  const manifest = packageFile ?? files.find((file) => /^(pyproject\.toml|requirements\.txt)$/i.test(file.path));
  const anchor = manifest ?? makefile ?? files[0];
  const findings: Finding[] = [];

  if (!anchor) return capFindings("setup-gaps", findings);

  if (manifest && !files.some(isLockfile)) {
    findings.push(absenceFinding("no-lockfile", "No lockfile found", "This project has a package manifest but no recognized lockfile was fetched.", anchor));
  }

  const reads = environmentReads(files.filter(isApplicationSource));
  if (reads.length > 0 && !files.some(isEnvExample)) {
    const source = reads[0];
    findings.push({
      id: makeFindingId("setup-gaps", source.file.path, source.line, "no-env-example"),
      severity: "medium",
      title: "No environment example file",
      detail: "The application reads environment variables but no .env.example or .env.sample was fetched.",
      evidence: {
        path: source.file.path,
        line: source.line,
        snippet: source.file.content.split(/\r?\n/)[source.line - 1]?.trim(),
      },
    });
  }

  if ((packageFile || makefile) && !hasTestCommand(packageFile, makefile)) {
    findings.push(absenceFinding("no-test-command", "No test command found", "package.json and the Makefile do not declare a test command.", packageFile ?? makefile!));
  }

  if (!files.some((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file.path))) {
    findings.push(absenceFinding("no-ci", "No CI workflow found", "No GitHub Actions workflow was fetched from .github/workflows/.", anchor));
  }

  if (!files.some(isReadme)) {
    findings.push(absenceFinding("no-readme", "No README found", "No root README file was fetched for this repository.", anchor));
  }

  return capFindings("setup-gaps", findings);
}

function isLockfile(file: ScannedFile): boolean {
  const filename = file.path.split("/").at(-1)?.toLowerCase();
  return Boolean(filename && (LOCKFILE_NAMES.has(filename) || filename.endsWith(".lock")));
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
  anchor: ScannedFile,
): Finding {
  const evidence = firstEvidence(anchor);
  return {
    id: makeFindingId("setup-gaps", evidence.path, evidence.line, label),
    severity: "medium",
    title,
    detail,
    evidence,
  };
}
