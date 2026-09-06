import type { Finding, ScannedFile } from "@/types";
import {
  capFindings,
  evidenceForLine,
  isEnvExample,
  isReadme,
  isSourceFile,
  makeFindingId,
} from "@/lib/checks/helpers";

type EnvironmentRead = {
  name: string;
  file: ScannedFile;
  line: number;
};

export function missingEnv(files: ScannedFile[]) {
  const documentedNames = new Set(
    files.filter(isEnvExample).flatMap(environmentNamesFromExample),
  );
  const readmes = files.filter(isReadme).map((file) => file.content).join("\n");
  const reads = environmentReads(files.filter(isSourceFile));
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const read of reads) {
    if (seen.has(read.name)) continue;
    seen.add(read.name);

    if (documentedNames.has(read.name) || mentionedInReadme(read.name, readmes)) continue;

    const evidence = evidenceForLine(read.file, read.line);
    findings.push({
      id: makeFindingId("missing-env", evidence.path, evidence.line, read.name),
      severity: "high",
      title: `Missing environment setup: ${read.name}`,
      detail: `${read.name} is read by the application but is not documented in an environment example or README.`,
      evidence,
    });
  }

  return capFindings("missing-env", findings);
}

export function environmentReads(files: ScannedFile[]): EnvironmentRead[] {
  const reads: EnvironmentRead[] = [];
  const patterns = [
    /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /\bos\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
    /\bos\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  ];

  for (const file of files) {
    for (const [index, line] of file.content.split(/\r?\n/).entries()) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match = pattern.exec(line);
        while (match) {
          reads.push({ name: match[1], file, line: index + 1 });
          match = pattern.exec(line);
        }
      }
    }
  }

  return reads;
}

function environmentNamesFromExample(file: ScannedFile): string[] {
  return file.content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((name): name is string => Boolean(name));
}

function mentionedInReadme(name: string, readme: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(readme);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
