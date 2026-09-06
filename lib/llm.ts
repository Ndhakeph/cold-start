import type { ScanResult, TaskBrief } from "@/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const TASK_MODEL = "gpt-5.6-luna";
const LLM_TIMEOUT_MS = 20_000;

type StructuredTaskBrief = {
  summary: unknown;
  stalled_because: unknown;
  tasks: unknown;
};

export async function generateTaskBrief(
  scan: Pick<ScanResult, "map" | "findings">,
): Promise<TaskBrief | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: TASK_MODEL,
        input: [
          {
            role: "system",
            content: "You turn deterministic repository scan results into three small, independent coding tasks. Use only the supplied repo map and findings. Never invent a file path. Every codex_prompt must be a complete, paste-ready prompt with these exact headings: Goal, Context, Constraints, Done when. Scope each task to about thirty minutes and cite at least one real scanned file path.",
          },
          {
            role: "user",
            content: JSON.stringify({ repo_map: scan.map, findings: scan.findings }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "cold_start_tasks",
            strict: true,
            schema: taskBriefSchema,
          },
        },
      }),
    });

    if (!response.ok) return null;
    const payload = await response.json() as OpenAIResponse;
    return parseTaskBrief(extractOutputText(payload), knownPaths(scan));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const taskBriefSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    stalled_because: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          codex_prompt: { type: "string" },
        },
        required: ["title", "why", "codex_prompt"],
      },
    },
  },
  required: ["summary", "stalled_because", "tasks"],
} as const;

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function extractOutputText(response: OpenAIResponse): string | null {
  if (response.output_text) return response.output_text;

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }

  return null;
}

function parseTaskBrief(text: string | null, paths: string[]): TaskBrief | null {
  if (!text) return null;

  try {
    const output = JSON.parse(text) as StructuredTaskBrief;
    if (
      typeof output.summary !== "string" ||
      typeof output.stalled_because !== "string" ||
      !Array.isArray(output.tasks) ||
      output.tasks.length !== 3
    ) {
      return null;
    }

    const tasks = output.tasks.map((task) => {
      if (!task || typeof task !== "object") return null;
      const candidate = task as Record<string, unknown>;
      const title = candidate.title;
      const why = candidate.why;
      const codexPrompt = candidate.codex_prompt;
      if (
        typeof title !== "string" ||
        typeof why !== "string" ||
        typeof codexPrompt !== "string" ||
        !hasPromptShape(codexPrompt) ||
        !paths.some((path) => codexPrompt.includes(path))
      ) {
        return null;
      }
      return {
        title,
        why,
        codexPrompt,
      };
    });

    if (tasks.some((task) => task === null)) return null;
    return {
      summary: output.summary,
      stalledBecause: output.stalled_because,
      tasks: tasks as TaskBrief["tasks"],
    };
  } catch {
    return null;
  }
}

function knownPaths(scan: Pick<ScanResult, "map" | "findings">): string[] {
  return [...new Set([
    ...scan.map.entrypoints,
    ...scan.map.commands.map((command) => command.source.path),
    ...scan.findings.map((finding) => finding.evidence.path),
  ])];
}

function hasPromptShape(prompt: string): boolean {
  return ["Goal", "Context", "Constraints", "Done when"].every((heading) =>
    new RegExp(`(^|\\n)(?:#{1,6}\\s*)?${heading}(?::|[ \\t]*$)`, "im").test(prompt),
  );
}
