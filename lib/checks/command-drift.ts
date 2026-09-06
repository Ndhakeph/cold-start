import type { Finding, ScannedFile } from "@/types";
import {
  capFindings,
  evidenceForLine,
  findLine,
  isReadme,
  makeFindingId,
} from "@/lib/checks/helpers";

type ReadmeCommand = {
  kind: "script" | "make";
  name: string;
  file: ScannedFile;
  line: number;
};

export function commandDrift(files: ScannedFile[]) {
  const readmes = files.filter(isReadme);
  const packageFile = files.find((file) => file.path === "package.json");
  const makefile = files.find((file) => /^makefile$/i.test(file.path));
  const scripts = packageFile ? packageScripts(packageFile.content) : {};
  const targets = makefile ? makeTargets(makefile.content) : new Set<string>();
  const commands = readmes.flatMap(readmeCommands);
  const findings: Finding[] = [];

  for (const command of commands) {
    const isKnown =
      command.kind === "script"
        ? Object.hasOwn(scripts, command.name)
        : targets.has(command.name);
    if (isKnown) continue;

    const evidence = evidenceForLine(command.file, command.line);
    findings.push({
      id: makeFindingId("command-drift", evidence.path, evidence.line, command.name),
      severity: "medium",
      title: `README command is not declared: ${command.name}`,
      detail:
        command.kind === "script"
          ? `The README invokes the ${command.name} script, but package.json does not declare it.`
          : `The README invokes the ${command.name} Make target, but the Makefile does not declare it.`,
      evidence,
    });
  }

  if (packageFile) {
    const readmeText = readmes.map((file) => file.content).join("\n");
    for (const script of Object.keys(scripts)) {
      if (new RegExp(`\\b${escapeRegExp(script)}\\b`).test(readmeText)) continue;
      const evidence = findLine(packageFile, new RegExp(`"${escapeRegExp(script)}"\\s*:`));
      findings.push({
        id: makeFindingId("command-drift", evidence.path, evidence.line, `undocumented-${script}`),
        severity: "low",
        title: `Script is not mentioned in the README: ${script}`,
        detail: `package.json declares the ${script} script, but no fetched README mentions it.`,
        evidence,
      });
    }
  }

  return capFindings("command-drift", findings);
}

function packageScripts(content: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return {};
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== "object") return {};

    return Object.fromEntries(
      Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function makeTargets(content: string): Set<string> {
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z0-9_.-]+)\s*:(?!=)/)?.[1])
      .filter((target): target is string => Boolean(target)),
  );
}

function readmeCommands(file: ScannedFile): ReadmeCommand[] {
  const commands: ReadmeCommand[] = [];
  let fence: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const [index, rawLine] of file.content.split(/\r?\n/).entries()) {
    const opening = rawLine.match(/^\s*(`{3,}|~{3,})/);
    if (opening && !fence) {
      fence = opening[1][0] as "`" | "~";
      fenceLength = opening[1].length;
      continue;
    }

    if (fence && new RegExp(`^\\s*${fence}{${fenceLength},}\\s*$`).test(rawLine)) {
      fence = null;
      continue;
    }
    if (!fence) continue;

    const command = parseCommand(rawLine.replace(/^\s*\$\s?/, "").trim());
    if (command) commands.push({ ...command, file, line: index + 1 });
  }

  return commands;
}

function parseCommand(line: string): Pick<ReadmeCommand, "kind" | "name"> | null {
  const nodeScript = line.match(/^(?:npm|pnpm|bun)\s+(?:run(?:-script)?\s+)([\w:.-]+)/);
  if (nodeScript) return { kind: "script", name: nodeScript[1] };

  const yarnScript = line.match(/^yarn(?:\s+run)?\s+([\w:.-]+)/);
  if (yarnScript && !["add", "create", "dlx", "init", "install", "remove"].includes(yarnScript[1])) {
    return { kind: "script", name: yarnScript[1] };
  }

  const makeTarget = line.match(/^make(?:\s+-[^\s]+)*\s+([\w:.-]+)/);
  if (makeTarget) return { kind: "make", name: makeTarget[1] };

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
