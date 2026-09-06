# Cold Start

A preflight check for coding agents. Paste a public GitHub repo URL and get back a
grounded `AGENTS.md`, a landmine report where every finding cites a file, and three
next-task prompts you can paste straight into Codex.

**Live:** _add Vercel URL_

## The problem

Point a coding agent at an unfamiliar or stale repo and it spends its first ten
minutes guessing: what the build command is, which directories matter, what is
half-finished, and which of the README's instructions are still true. Everyone
writes an `AGENTS.md` by hand, once, and never updates it.

## What it does

Cold Start reads the repository and produces, in about ten seconds and with no model
call:

- **A repo map** — detected stack, entrypoints, top-level directory roles, and the
  real dev/build/test/lint commands, each shown with the file it came from.
- **A landmine report** — the things that make an agent fail:
  - `missing-env` — environment variables read in source with no `.env.example` or
    README entry
  - `command-drift` — README commands that are not declared scripts or Makefile
    targets, and declared scripts the README never mentions
  - `setup-gaps` — no lockfile, no test command, no CI workflow, no README
  - `unfinished` — TODO/FIXME/HACK markers, skipped tests and merge-conflict
    markers, aggregated per file
- **A generated `AGENTS.md`** — copy or download it straight into the repo you
  scanned.

Then a single model call adds a plain-English summary, a read on why the project
stalled, and three next tasks written as ready-to-paste Codex prompts.

## Why it is trustworthy

Every finding carries evidence: a file path and the line or snippet it came from. If
a claim cannot be cited, it is not reported. Severity is fixed in code per check, not
decided by a model.

The deterministic layer and the model layer are strictly separated. The checks are
pure functions with no I/O, and `lib/llm.ts` is the only file that talks to OpenAI. If
that call fails, times out, or the key is absent, the repo map, the findings and the
generated `AGENTS.md` all still render. The scan degrades; it does not break.

The scan also reports its own coverage — "scanned 32 of 64 files" — so you know
exactly how much of the repository the findings rest on.

## Run it locally

```bash
git clone https://github.com/Ndhakeph/cold-start
cd cold-start
npm install
cp .env.example .env.local   # add OPENAI_API_KEY, and GITHUB_TOKEN if you have one
npm run dev
```

`GITHUB_TOKEN` is optional but recommended — unauthenticated GitHub API access is
capped at 60 requests per hour.

## Architecture

```
app/page.tsx            single screen: input, loading, report
app/api/scan/route.ts   POST { url } -> ScanResult, the only orchestration layer
lib/github.ts           all GitHub fetching; nothing else touches the network
lib/checks/*.ts         one pure function per check
lib/map.ts              repo map derivation, pure
lib/agentsmd.ts         renders AGENTS.md from a ScanResult, pure
lib/llm.ts              the single OpenAI call
types.ts                ScanResult and every sub-type
```

Next.js (App Router), TypeScript, Tailwind. No database, no auth.

## Limits

Public repositories only. Files over 100 KB and generated directories are skipped and
source-file fetching is capped, so very large monorepos are sampled rather than read
in full — the coverage line always says how many.

---

Built at Codex Build House Pune, 5 September 2026, with Codex.
