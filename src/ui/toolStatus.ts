function normalizeToolArgs(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function toolActivityLabel(toolName: string): string {
  switch (toolName) {
    case "WorkspaceRead":
      return "Inspecting workspace";
    case "WorkspaceEdit":
      return "Editing workspace";
    case "Shell":
      return "Running shell command";
    case "UserInteraction":
      return "Handling interaction";
    case "Memory":
      return "Updating memory";
    case "Web":
      return "Fetching web context";
    case "Notebook":
      return "Working with notebook";
    case "Orchestrate":
      return "Coordinating work";
    case "Integration":
      return "Inspecting integrations";
    default:
      return `Running ${toolName}`;
  }
}

function truncateText(value: string, maxLen: number): string {
  return value.length > maxLen ? `${value.slice(0, maxLen - 1)}…` : value;
}

function renderArgValue(value: unknown): string {
  if (typeof value === "string") {
    return truncateText(value, 28);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  try {
    return truncateText(JSON.stringify(value), 28);
  } catch {
    return truncateText(String(value), 28);
  }
}

function orderToolArgs(args: Record<string, unknown>): Array<[string, unknown]> {
  const priority = [
    "action",
    "path",
    "file_path",
    "command",
    "query",
    "pattern",
    "start_line",
    "end_line",
    "max_depth",
    "max_results",
  ];

  return Object.entries(args).sort(([left], [right]) => {
    const leftPriority = priority.indexOf(left);
    const rightPriority = priority.indexOf(right);

    if (leftPriority !== -1 || rightPriority !== -1) {
      if (leftPriority === -1) return 1;
      if (rightPriority === -1) return -1;
      return leftPriority - rightPriority;
    }

    return left.localeCompare(right);
  });
}

export function summarizeToolArgs(args: Record<string, unknown> | undefined, maxLen = 72): string {
  if (!args || Object.keys(args).length === 0) {
    return "";
  }

  const parts = orderToolArgs(args).map(([key, value]) => `${key}: ${renderArgValue(value)}`);
  return truncateText(parts.join(", "), maxLen);
}

export function formatToolStatus(
  toolName: string,
  input: unknown,
  phase: "running" | "analyzing" = "running",
): string {
  const args = normalizeToolArgs(input);
  const summary = summarizeToolArgs(args, 96);

  if (phase === "running") {
    const label = toolActivityLabel(toolName);
    return summary ? `${label} · ${summary}` : label;
  }

  const label = `Analyzing ${toolName} result`;
  return summary ? `${label} · ${summary}` : label;
}

export function formatProgressStatus(
  currentStatus: string,
  progress?: { turn?: unknown; maxTurns?: unknown },
): string {
  if (currentStatus.trim().length > 0) {
    return currentStatus;
  }

  const turn = typeof progress?.turn === "number" ? progress.turn : undefined;
  const maxTurns = typeof progress?.maxTurns === "number" ? progress.maxTurns : undefined;

  if (typeof turn === "number" && typeof maxTurns === "number") {
    return `Working… (turn ${turn}/${maxTurns})`;
  }

  return "Working…";
}

export function resolveMaxTurns(value: unknown, fallback = 50): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.floor(parsed));
    }
  }

  return fallback;
}
