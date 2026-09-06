import { commandDrift } from "@/lib/checks/command-drift";
import { renderAgentsMd } from "@/lib/agentsmd";
import { countBySeverity } from "@/lib/checks/helpers";
import { missingEnv } from "@/lib/checks/missing-env";
import { setupGaps } from "@/lib/checks/setup-gaps";
import { unfinished } from "@/lib/checks/unfinished";
import { fetchScanSnapshot, GitHubScanError } from "@/lib/github";
import { generateTaskBrief } from "@/lib/llm";
import { deriveRepoMap } from "@/lib/map";
import type { CheckResult, ScanFailure, ScanResult, SeverityCounts } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const input = await request.json().catch(() => null) as { url?: unknown } | null;
  if (!input || typeof input.url !== "string") {
    return failure(
      400,
      "INVALID_URL",
      "Enter a valid GitHub repository URL, such as https://github.com/owner/repo.",
    );
  }

  try {
    const snapshot = await fetchScanSnapshot(input.url);
    const repositoryPaths = snapshot.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path);
    const checks: CheckResult[] = [
      commandDrift(snapshot.files),
      missingEnv(snapshot.files),
      setupGaps(snapshot.files, repositoryPaths),
      unfinished(snapshot.files),
    ];
    const findings = checks.flatMap((check) => check.findings);
    const result: ScanResult = {
      repository: snapshot.repository,
      map: deriveRepoMap(snapshot),
      findings,
      checks,
      severityCounts: totalSeverityCounts(checks),
      agentsMd: "",
      taskBrief: null,
    };

    result.agentsMd = renderAgentsMd(result);
    result.taskBrief = await generateTaskBrief(result);

    return Response.json(result);
  } catch (error) {
    if (error instanceof GitHubScanError) {
      return failure(statusFor(error.code), error.code, error.message);
    }

    return failure(
      502,
      "UPSTREAM_ERROR",
      "The scan could not be completed. Please try again.",
    );
  }
}

function totalSeverityCounts(checks: CheckResult[]): SeverityCounts {
  const total: SeverityCounts = { high: 0, medium: 0, low: 0 };

  for (const check of checks) {
    const visible = countBySeverity(check.findings);
    for (const severity of ["high", "medium", "low"] as const) {
      total[severity] += visible[severity] + check.omittedBySeverity[severity];
    }
  }

  return total;
}

function failure(status: number, code: ScanFailure["error"]["code"], message: string): Response {
  return Response.json({ error: { code, message } } satisfies ScanFailure, { status });
}

function statusFor(code: ScanFailure["error"]["code"]): number {
  switch (code) {
    case "INVALID_URL":
      return 400;
    case "REPOSITORY_UNAVAILABLE":
      return 404;
    case "EMPTY_REPOSITORY":
      return 422;
    case "RATE_LIMITED":
      return 429;
    case "UPSTREAM_ERROR":
      return 502;
  }
}
