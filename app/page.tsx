"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { CheckResult, Finding, ScanFailure, ScanResult, Severity } from "@/types";

const EXAMPLE_URL = "https://github.com/openai/codex";
const SCAN_STEPS = [
  "Checking repository access…",
  "Reading the repository tree…",
  "Fetching the files that matter…",
  "Running deterministic checks…",
];
const SEVERITIES: Severity[] = ["high", "medium", "low"];

export default function Home() {
  const [url, setUrl] = useState(EXAMPLE_URL);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isScanning) return;
    const interval = window.setInterval(
      () => setStep((current) => Math.min(current + 1, SCAN_STEPS.length - 1)),
      1_600,
    );
    return () => window.clearInterval(interval);
  }, [isScanning]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setIsScanning(true);
    setStep(0);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body: unknown = await response.json();

      if (!response.ok || isScanFailure(body)) {
        setError(isScanFailure(body) ? body.error.message : "The scan could not be completed. Please try again.");
        return;
      }

      setResult(body as ScanResult);
    } catch {
      setError("The scan could not be completed. Check your connection and try again.");
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-10 max-w-3xl">
          <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.24em] text-accent">
            Cold Start
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Know the sharp edges before you start coding.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
            Scan a public GitHub repository for setup gaps, drifting commands, missing environment documentation, and unfinished work.
          </p>
        </header>

        <form className="rounded-2xl border border-border bg-panel p-4 shadow-sm" onSubmit={submit}>
          <label className="sr-only" htmlFor="repository-url">
            Public GitHub repository URL
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="repository-url"
              className="min-h-12 w-full rounded-xl border border-border bg-background px-4 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={EXAMPLE_URL}
              spellCheck={false}
              disabled={isScanning}
            />
            <button
              className="min-h-12 shrink-0 rounded-xl bg-accent px-6 text-sm font-semibold text-accent-foreground transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isScanning}
              type="submit"
            >
              {isScanning ? "Scanning…" : "Scan repository"}
            </button>
          </div>
          {isScanning && (
            <p aria-live="polite" className="mt-3 font-mono text-xs text-muted">
              {SCAN_STEPS[step]}
            </p>
          )}
        </form>

        {error && (
          <section className="mt-6 rounded-2xl border border-border bg-panel px-5 py-4" role="alert">
            <p className="font-semibold">Scan unavailable</p>
            <p className="mt-1 text-sm leading-6 text-muted">{error}</p>
          </section>
        )}

        {result && <Report result={result} />}
      </div>
    </main>
  );
}

function Report({ result }: { result: ScanResult }) {
  const { repository, map } = result;

  return (
    <div className="mt-8 space-y-8" aria-live="polite">
      <section className="rounded-2xl border border-border bg-panel p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="font-mono text-xs text-muted">{repository.owner}/{repository.name}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{repository.name}</h2>
            {repository.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{repository.description}</p>}
          </div>
          <a
            className="rounded-lg border border-border px-3 py-2 font-mono text-xs transition hover:border-accent hover:text-accent"
            href={repository.url}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub ↗
          </a>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Scan coverage"
            value={map.candidateFileCount === 0 ? "No recognised source files" : `Scanned ${map.scannedFileCount} of ${map.candidateFileCount} files`}
          />
          <Metric label="Open issues" value={String(map.openIssueCount)} />
          <Metric label="Last commit" value={map.daysSinceLastCommit === null ? "Unavailable" : `${map.daysSinceLastCommit}d ago`} />
          <Metric label="Default branch" value={repository.defaultBranch} />
        </div>
        {map.isPartial && (
          <p className="mt-4 rounded-lg bg-accent/10 px-3 py-2 text-sm leading-6 text-foreground">
            Partial scan: the twenty-second deadline was reached. Findings only reflect the {map.scannedFileCount} source files that were fetched.
          </p>
        )}

        <div className="mt-7 grid gap-6 lg:grid-cols-2">
          <MapList label="Detected stack" values={map.stack} empty="No stack signals detected." />
          <MapList label="Entrypoints" values={map.entrypoints} empty="No conventional entrypoint detected." mono />
          <LanguageList languages={map.languages} />
          <DirectoryList directories={map.directories} />
        </div>

        {map.commands.length > 0 && (
          <div className="mt-7">
            <SectionLabel>Commands</SectionLabel>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {map.commands.map((command) => (
                <div className="rounded-lg border border-border px-3 py-2" key={`${command.kind}-${command.command}-${command.source.path}`}>
                  <p className="font-mono text-xs text-accent">{command.kind}</p>
                  <p className="mt-1 font-mono text-sm">{command.command}</p>
                  <p className="mt-1 font-mono text-xs text-muted">{command.source.path}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {map.lastCommitMessage && (
          <p className="mt-7 border-t border-border pt-4 text-sm text-muted">
            Latest commit: <span className="font-mono text-foreground">{map.lastCommitMessage}</span>
          </p>
        )}
      </section>

      <AgentsArtifact value={result.agentsMd} />
      <TaskBriefSection brief={result.taskBrief} />

      <section className="rounded-2xl border border-border bg-panel p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">Deterministic findings</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">What to handle before the first task</h2>
          </div>
          <div className="flex gap-2" aria-label="Finding counts by severity">
            {SEVERITIES.map((severity) => (
              <span className="rounded-full border border-border px-3 py-1 font-mono text-xs" key={severity}>
                {result.severityCounts[severity]} {severity}
              </span>
            ))}
          </div>
        </div>

        {result.findings.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border p-5 text-sm leading-6 text-muted">
            No deterministic risks were found in the inspected files.
          </p>
        ) : (
          <div className="mt-7 space-y-8">
            {SEVERITIES.map((severity) => (
              <FindingGroup
                checks={result.checks}
                findings={result.findings.filter((finding) => finding.severity === severity)}
                key={severity}
                severity={severity}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AgentsArtifact({ value }: { value: string }) {
  return (
    <section className="rounded-2xl border border-border bg-panel p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">Generated artifact</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">AGENTS.md for this repository</h2>
        </div>
        <div className="flex gap-2">
          <CopyButton value={value} />
          <button
            className="rounded-lg border border-border px-3 py-2 font-mono text-xs transition hover:border-accent hover:text-accent"
            onClick={() => downloadAgentsMd(value)}
            type="button"
          >
            Download
          </button>
        </div>
      </div>
      <pre className="mt-6 max-h-130 overflow-auto rounded-xl bg-code p-4 font-mono text-xs leading-6 text-code-foreground whitespace-pre-wrap">
        {value}
      </pre>
    </section>
  );
}

function TaskBriefSection({ brief }: { brief: ScanResult["taskBrief"] }) {
  if (!brief) {
    return <p className="px-1 text-sm text-muted">Task summary unavailable.</p>;
  }

  return (
    <section className="rounded-2xl border border-border bg-panel p-5 sm:p-7">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">Suggested next tasks</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">A focused first thirty minutes</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{brief.summary}</p>
      {brief.stalledBecause && <p className="mt-2 text-sm leading-6 text-muted">{brief.stalledBecause}</p>}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {brief.tasks.map((task) => (
          <article className="rounded-xl border border-border p-4" key={task.title}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold leading-6">{task.title}</h3>
              <CopyButton value={task.codexPrompt} />
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{task.why}</p>
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-code p-3 font-mono text-xs leading-5 text-code-foreground whitespace-pre-wrap">
              {task.codexPrompt}
            </pre>
          </article>
        ))}
      </div>
    </section>
  );
}

function FindingGroup({
  severity,
  findings,
  checks,
}: {
  severity: Severity;
  findings: Finding[];
  checks: CheckResult[];
}) {
  const omitted = checks
    .map((check) => ({ id: readableCheckName(check.id), count: check.omittedBySeverity[severity] }))
    .filter((item) => item.count > 0);

  if (findings.length === 0 && omitted.length === 0) return null;

  return (
    <section>
      <SectionLabel>{severity} severity</SectionLabel>
      <div className="mt-3 space-y-3">
        {findings.map((finding) => <FindingCard finding={finding} key={finding.id} />)}
        {omitted.map((item) => (
          <p className="font-mono text-xs text-muted" key={item.id}>
            +{item.count} more {item.id} finding{item.count === 1 ? "" : "s"}
          </p>
        ))}
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className="rounded-xl border border-border p-4">
      <h4 className="font-semibold">{finding.title}</h4>
      <p className="mt-1 text-sm leading-6 text-muted">{finding.detail}</p>
      <div className="mt-3 rounded-lg bg-code px-3 py-2 font-mono text-xs leading-5 text-code-foreground">
        <p>{finding.evidence.path}{finding.evidence.line ? `:${finding.evidence.line}` : ""}</p>
        {finding.evidence.snippet && <p className="mt-1 break-words text-muted">{finding.evidence.snippet}</p>}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-code px-4 py-3">
      <p className="font-mono text-xs text-muted">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [didCopy, setDidCopy] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDidCopy(true);
      window.setTimeout(() => setDidCopy(false), 1_500);
    } catch {
      setDidCopy(false);
    }
  }

  return (
    <button
      className="rounded-lg border border-border px-3 py-2 font-mono text-xs transition hover:border-accent hover:text-accent"
      onClick={copy}
      type="button"
    >
      {didCopy ? "Copied" : "Copy"}
    </button>
  );
}

function MapList({ label, values, empty, mono = false }: { label: string; values: string[]; empty: string; mono?: boolean }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {values.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {values.map((value) => (
            <span className={`rounded-lg border border-border px-2.5 py-1.5 text-xs ${mono ? "font-mono" : ""}`} key={value}>
              {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageList({ languages }: { languages: ScanResult["map"]["languages"] }) {
  return (
    <div>
      <SectionLabel>Languages</SectionLabel>
      {languages.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No source-language files detected.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {languages.slice(0, 6).map((language) => (
            <div className="flex justify-between border-b border-border pb-2 text-sm" key={language.name}>
              <span>{language.name}</span>
              <span className="font-mono text-muted">{language.fileCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DirectoryList({ directories }: { directories: ScanResult["map"]["directories"] }) {
  return (
    <div>
      <SectionLabel>Top-level directories</SectionLabel>
      {directories.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No top-level directories detected.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {directories.slice(0, 8).map((directory) => (
            <div className="text-sm" key={directory.name}>
              <span className="font-mono text-xs text-accent">{directory.name}/</span>
              <p className="mt-0.5 text-muted">{directory.role}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted">{children}</h3>;
}

function readableCheckName(id: CheckResult["id"]): string {
  return id.replace(/-/g, " ");
}

function isScanFailure(value: unknown): value is ScanFailure {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      value.error &&
      typeof value.error === "object" &&
      "message" in value.error &&
      typeof value.error.message === "string",
  );
}

function downloadAgentsMd(value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "AGENTS.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
