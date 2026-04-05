import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BackgroundRunManager } from "../../runtime/backgroundRuns.js";
import { WorktreeManager } from "../../runtime/worktrees.js";
import { createProjectSessionStore } from "../../persistence/runtimeSessions.js";
import type { Tool, ToolApprovalRequest, ToolContext, ToolResult } from "../Tool.js";
import { truncateText } from "../shared/common.js";

const OrchestrateInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run_verification"),
    commands: z.array(z.enum(["test", "typecheck", "build"])).optional(),
  }),
  z.object({
    action: z.literal("background_start"),
    task: z.enum(["agent", "verification"]),
    prompt: z.string().optional(),
    session_id: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    commands: z.array(z.enum(["test", "typecheck", "build"])).optional(),
  }),
  z.object({
    action: z.literal("background_get"),
    run_id: z.string(),
  }),
  z.object({
    action: z.literal("background_list"),
  }),
  z.object({
    action: z.literal("background_stop"),
    run_id: z.string(),
  }),
  z.object({
    action: z.literal("worktree_create"),
    session_id: z.string(),
    branch: z.string().optional(),
  }),
  z.object({
    action: z.literal("worktree_get"),
    session_id: z.string(),
  }),
  z.object({
    action: z.literal("worktree_status"),
  }),
  z.object({
    action: z.literal("worktree_remove"),
    session_id: z.string(),
  }),
  z.object({
    action: z.literal("plan_status"),
  }),
]);

export class OrchestrateTool implements Tool {
  name = "Orchestrate";
  aliases = ["SearchSubagent", "ExecutionSubagent", "Agent", "TaskRunner", "WorktreeFlow"];
  description = "Coordinate verification runs, detached background agent tasks, worktree workflows, and planning-file status from one orchestration surface.";
  category = "orchestrate" as const;
  capability = "orchestrate" as const;
  inputSchema = OrchestrateInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = OrchestrateInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "run_verification": {
        const commands = parsed.data.commands ?? ["test", "typecheck", "build"];
        const results = commands.map((command) => runVerificationCommand(command, context.cwd));
        return {
          success: results.every((result) => result.success),
          output: results.map((result) => `${result.command}\n${result.output}`).join("\n\n---\n\n"),
          data: { results },
          summary: `Ran ${results.length} verification command(s)`,
        };
      }

      case "background_start": {
        const manager = new BackgroundRunManager(context.cwd);
        if (parsed.data.task === "agent") {
          if (!parsed.data.prompt?.trim()) {
            return {
              success: false,
              output: "",
              error: "background_start task=agent requires a prompt.",
            };
          }

          const run = manager.startAgentRun({
            prompt: parsed.data.prompt,
            sessionId: parsed.data.session_id,
            parentSessionId: context.runtime?.sessionId ?? null,
            provider: parsed.data.provider,
            model: parsed.data.model,
            initiatedBy: this.name,
          });

          return {
            success: true,
            output: formatBackgroundRun(run),
            data: run,
            summary: `Started background agent run ${run.id}`,
          };
        }

        const run = manager.startVerificationRun({
          commands: parsed.data.commands ?? ["test", "typecheck", "build"],
          parentSessionId: context.runtime?.sessionId ?? null,
          initiatedBy: this.name,
        });

        return {
          success: true,
          output: formatBackgroundRun(run),
          data: run,
          summary: `Started background verification ${run.id}`,
        };
      }

      case "background_get": {
        const manager = new BackgroundRunManager(context.cwd);
        const run = manager.getRun(parsed.data.run_id);
        if (!run) {
          return {
            success: false,
            output: "",
            error: `Background run not found: ${parsed.data.run_id}`,
          };
        }

        return {
          success: true,
          output: formatBackgroundRun(run, true),
          data: run,
          summary: `Loaded background run ${run.id}`,
        };
      }

      case "background_list": {
        const manager = new BackgroundRunManager(context.cwd);
        const runs = manager.listRuns();
        const summary = manager.getSummary();
        return {
          success: true,
          output: runs.length === 0
            ? "No background runs recorded for this project yet."
            : [
                `Background runs: ${summary.total} total (${summary.active} active, ${summary.completed} completed, ${summary.failed} failed, ${summary.stopped} stopped)`,
                "",
                ...runs.map((run) => formatBackgroundRun(run)),
              ].join("\n\n"),
          data: { runs, summary },
          summary: `Loaded ${runs.length} background run(s)`,
        };
      }

      case "background_stop": {
        const manager = new BackgroundRunManager(context.cwd);
        const run = manager.stopRun(parsed.data.run_id);
        if (!run) {
          return {
            success: false,
            output: "",
            error: `Background run not found: ${parsed.data.run_id}`,
          };
        }

        return {
          success: true,
          output: formatBackgroundRun(run, true),
          data: run,
          summary: `Stop requested for background run ${run.id}`,
        };
      }

      case "worktree_create": {
        const manager = createWorktreeManager(context.cwd);
        const availability = manager.getAvailability();
        if (!availability.available) {
          return {
            success: false,
            output: "",
            error: availability.reason ?? "Git worktrees are not available for this repository.",
          };
        }

        const worktreePath = manager.createWorktree(parsed.data.session_id, parsed.data.branch);
        const worktree = manager.getWorktree(parsed.data.session_id);
        updateSessionWorktreeLink(context.cwd, parsed.data.session_id, worktreePath, worktree?.branch ?? parsed.data.branch ?? null);
        return {
          success: true,
          output: [
            `Created worktree ${worktreePath}`,
            worktree?.branch ? `Branch: ${worktree.branch}` : undefined,
            availability.baseRef ? `Base ref: ${availability.baseRef}` : undefined,
          ].filter(Boolean).join("\n"),
          data: {
            worktreePath,
            branch: worktree?.branch ?? parsed.data.branch ?? null,
            baseRef: availability.baseRef,
            repoRoot: availability.repoRoot,
          },
          summary: `Created worktree for ${parsed.data.session_id}`,
        };
      }

      case "worktree_get": {
        const manager = createWorktreeManager(context.cwd);
        const worktree = manager.getWorktree(parsed.data.session_id);
        const worktreePath = worktree?.worktreePath ?? `No worktree registered for ${parsed.data.session_id}.`;
        return {
          success: true,
          output: worktreePath,
          data: worktree
            ? {
                worktreePath: worktree.worktreePath,
                branch: worktree.branch,
                createdAt: worktree.createdAt,
              }
            : { worktreePath: null },
          summary: `Looked up worktree for ${parsed.data.session_id}`,
        };
      }

      case "worktree_status": {
        const manager = createWorktreeManager(context.cwd);
        const availability = manager.getAvailability();
        return {
          success: availability.available,
          output: availability.available
            ? [
                `Worktrees available for ${availability.gitRoot}`,
                `Worktree root: ${availability.worktreeDir}`,
                availability.baseRef ? `Base ref: ${availability.baseRef}` : undefined,
              ].filter(Boolean).join("\n")
            : `Worktrees unavailable: ${availability.reason ?? "unknown reason"}`,
          data: availability,
          summary: availability.available ? "Worktree support available" : "Worktree support unavailable",
        };
      }

      case "worktree_remove": {
        const manager = createWorktreeManager(context.cwd);
        manager.removeWorktree(parsed.data.session_id);
        updateSessionWorktreeLink(context.cwd, parsed.data.session_id, null, null);
        return {
          success: true,
          output: `Removed worktree for ${parsed.data.session_id}`,
          summary: `Removed worktree for ${parsed.data.session_id}`,
        };
      }

      case "plan_status": {
        const files = ["task_plan.md", "findings.md", "progress.md"];
        const sections = files.map((file) => {
          const filePath = join(context.cwd, file);
          const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : `${file} is missing.`;
          const truncated = truncateText(content, 4_000, "\n\n[Plan excerpt truncated]");
          return `# ${file}\n${truncated.text}`;
        });
        return {
          success: true,
          output: sections.join("\n\n"),
          summary: "Loaded planning file status",
        };
      }
    }
  }

  buildApprovalRequest(input: unknown): ToolApprovalRequest | null {
    const parsed = OrchestrateInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        toolName: this.name,
        toolArgs: {},
        approvalMessage: "Allow orchestration action?",
        riskLevel: "high",
        resumable: true,
      };
    }

    switch (parsed.data.action) {
      case "run_verification":
      case "plan_status":
      case "worktree_status":
      case "background_get":
      case "background_list":
        return null;
      default:
        return {
          toolName: this.name,
          toolArgs: parsed.data as unknown as Record<string, unknown>,
          approvalMessage: `Allow orchestration action ${parsed.data.action}?`,
          riskLevel: parsed.data.action.startsWith("worktree") ? "high" : "medium",
          resumable: true,
        };
    }
  }
}

function formatBackgroundRun(
  run: {
    id: string;
    task: string;
    status: string;
    sessionId?: string;
    commands?: string[];
    provider?: string;
    model?: string;
    logPath: string;
    recordPath: string;
    summary?: string;
    finishedAt?: string;
    updatedAt: string;
  },
  includePaths = false,
): string {
  return [
    `${run.id} · ${run.task} · ${run.status}`,
    run.sessionId ? `Session: ${run.sessionId}` : undefined,
    run.commands?.length ? `Commands: ${run.commands.join(", ")}` : undefined,
    run.provider ? `Provider: ${run.provider}` : undefined,
    run.model ? `Model: ${run.model}` : undefined,
    run.summary ? `Summary: ${run.summary}` : undefined,
    `Updated: ${run.finishedAt ?? run.updatedAt}`,
    includePaths ? `Log: ${run.logPath}` : undefined,
    includePaths ? `Record: ${run.recordPath}` : undefined,
  ].filter(Boolean).join("\n");
}

function createWorktreeManager(cwd: string): WorktreeManager {
  return new WorktreeManager({
    repoRoot: cwd,
    worktreeDir: join(cwd, ".pebble", "worktrees"),
  });
}

function updateSessionWorktreeLink(
  cwd: string,
  sessionId: string,
  worktreePath: string | null,
  branch: string | null,
): void {
  const sessionStore = createProjectSessionStore(cwd);
  if (!sessionStore.loadTranscript(sessionId)) {
    return;
  }

  sessionStore.updateMetadata(sessionId, {
    worktree: worktreePath
      ? {
          path: worktreePath,
          ...(branch ? { branch } : {}),
          linkedAt: new Date().toISOString(),
        }
      : null,
  });
}

function runVerificationCommand(
  command: "test" | "typecheck" | "build",
  cwd: string,
): { command: string; success: boolean; output: string; exitCode: number } {
  const cmd = command === "test"
    ? ["bun", "test"]
    : command === "typecheck"
      ? ["bun", "run", "typecheck"]
      : ["bun", "run", "build"];
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const combined = [result.stdout.toString("utf-8").trim(), result.stderr.toString("utf-8").trim()]
    .filter(Boolean)
    .join("\n\n") || "(no output)";
  const truncated = truncateText(combined, 20_000);

  return {
    command,
    success: result.exitCode === 0,
    output: truncated.text,
    exitCode: result.exitCode,
  };
}
