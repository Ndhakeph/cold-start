<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:cold-start -->

# Cold Start — project guide

## What this is
A preflight check for coding agents. Input: a public GitHub repo URL.
Output: a repo map, a landmine report where every finding cites a file,
a generated AGENTS.md, and three next-task Codex prompts.
Built at Codex Build House Pune, 5 Sep 2026.

## Stack
Next.js (App Router) · TypeScript · Tailwind · no database · no auth · Vercel.

## Commands
dev `npm run dev` · build `npm run build` · lint `npm run lint`
`npm run build` must pass before any commit.

## Layout
- app/page.tsx — the single screen: input, loading, report
- app/api/scan/route.ts — POST { url } -> ScanResult
- lib/github.ts — all GitHub fetching, nothing else
- lib/checks/*.ts — one file per check, all pure functions
- lib/map.ts — repo map derivation, pure
- lib/agentsmd.ts — renders an AGENTS.md from a ScanResult, pure
- lib/llm.ts — the ONLY file that talks to OpenAI
- types.ts — ScanResult and every sub-type, single source of truth

## Rules
- Every check is a pure function (files) => Finding[]. No I/O inside a check.
- No claim may be unsourced: every Finding carries evidence (path + line or
  snippet). If you cannot cite it, do not report it.
- Exactly one LLM call per scan, in lib/llm.ts. If it fails or times out, the
  page still renders the full deterministic report.
- No new dependencies without asking. Never commit .env.local.
- Do not remove the nextjs-agent-rules block above; `next dev` re-adds it.

## Done means
`npm run build` passes and a scan of https://github.com/openai/codex renders
a report with findings and no unhandled error.

<!-- END:cold-start -->
