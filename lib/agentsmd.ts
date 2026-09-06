import type { Finding, ScanResult } from "@/types";

export function renderAgentsMd(result: ScanResult): string {
  const { repository, map } = result;
  const landmines = result.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "medium",
  );

  return [
    "# AGENTS.md",
    "",
    "## What this repository is",
    "",
    `- **Repository:** ${repository.owner}/${repository.name}`,
    `- **Description:** ${repository.description ?? "No description provided."}`,
    `- **Default branch:** ${repository.defaultBranch}`,
    `- **Primary stack:** ${map.stack.length > 0 ? map.stack.join(", ") : "Not detected"}`,
    "",
    "## Commands",
    "",
    ...commandLines(result),
    "",
    "## Directory map",
    "",
    ...(map.directories.length > 0
      ? map.directories.map((directory) => `- \`${directory.name}/\` — ${directory.role}`)
      : ["- No top-level directories were detected."]),
    "",
    "## Entrypoints",
    "",
    ...(map.entrypoints.length > 0
      ? map.entrypoints.map((entrypoint) => `- \`${entrypoint}\``)
      : ["- No conventional entrypoint was detected."]),
    "",
    "## Known landmines",
    "",
    ...(landmines.length > 0
      ? landmines.map(renderLandmine)
      : ["- No high- or medium-severity deterministic findings were reported."]),
  ].join("\n");
}

function commandLines(result: ScanResult): string[] {
  if (result.map.commands.length === 0) {
    return ["- No conventional dev, build, test, or lint command was detected."];
  }

  return result.map.commands.map(
    (command) => `- **${command.kind}:** \`${command.command}\` (from \`${command.source.path}\`)`,
  );
}

function renderLandmine(finding: Finding): string {
  const location = `${finding.evidence.path}${finding.evidence.line ? `:${finding.evidence.line}` : ""}`;
  return `- **${finding.severity}:** ${finding.title} — ${finding.detail} (evidence: \`${location}\`)`;
}
