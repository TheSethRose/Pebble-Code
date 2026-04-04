import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BackgroundSessionManager } from "../../runtime/backgroundSessions.js";
import { WorktreeManager } from "../../runtime/worktrees.js";
import type { Tool, ToolApprovalRequest, ToolContext, ToolResult } from "../Tool.js";
import { truncateText } from "../shared/common.js";

const OrchestrateInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run_verification"),
    commands: z.array(z.enum(["test", "typecheck", "build"])) .optional(),
  }),
  z.object({
    action: z.literal("background_start"),
    prompt: z.string(),
    session_id: z.string().optional(),
  }),
  z.object({
    action: z.literal("background_list"),
  }),
  z.object({
    action: z.literal("background_read"),
    session_id: z.string(),
  }),
  z.object({
    action: z.literal("background_stop"),
    session_id: z.string(),
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
  description = "Coordinate verification runs, background task records, worktree workflows, and planning-file status from one orchestration surface.";
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
        const manager = new BackgroundSessionManager(join(context.cwd, ".pebble", "background-sessions"));
        const session = manager.startSession(
          parsed.data.session_id ?? `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          parsed.data.prompt,
        );
        return {
          success: true,
          output: `Started background session ${session.id}`,
          data: session,
          summary: `Started background session ${session.id}`,
        };
      }

      case "background_list": {
        const manager = new BackgroundSessionManager(join(context.cwd, ".pebble", "background-sessions"));
        const sessions = manager.listSessions();
        return {
          success: true,
          output: sessions.length > 0
            ? sessions.map((session) => `${session.id} [${session.status}] pid=${session.pid ?? "n/a"}`).join("\n")
            : "No background sessions.",
          data: { sessions },
          summary: `Listed ${sessions.length} background sessions`,
        };
      }

      case "background_read": {
        const manager = new BackgroundSessionManager(join(context.cwd, ".pebble", "background-sessions"));
        const output = manager.getOutput(parsed.data.session_id);
        return {
          success: true,
          output: output || "(no output yet)",
          data: { sessionId: parsed.data.session_id },
          summary: `Read background session ${parsed.data.session_id}`,
        };
      }

      case "background_stop": {
        const manager = new BackgroundSessionManager(join(context.cwd, ".pebble", "background-sessions"));
        manager.stopSession(parsed.data.session_id);
        return {
          success: true,
          output: `Stopped background session ${parsed.data.session_id}`,
          summary: `Stopped background session ${parsed.data.session_id}`,
        };
      }

      case "worktree_create": {
        const manager = new WorktreeManager({ worktreeDir: join(context.cwd, ".pebble", "worktrees") });
        const worktreePath = manager.createWorktree(parsed.data.session_id, parsed.data.branch);
        return {
          success: true,
          output: `Created worktree ${worktreePath}`,
          data: { worktreePath },
          summary: `Created worktree for ${parsed.data.session_id}`,
        };
      }

      case "worktree_get": {
        const manager = new WorktreeManager({ worktreeDir: join(context.cwd, ".pebble", "worktrees") });
        const worktreePath = manager.getWorktreePath(parsed.data.session_id) ?? "(not loaded in current process)";
        return {
          success: true,
          output: worktreePath,
          data: { worktreePath },
          summary: `Looked up worktree for ${parsed.data.session_id}`,
        };
      }

      case "worktree_remove": {
        const manager = new WorktreeManager({ worktreeDir: join(context.cwd, ".pebble", "worktrees") });
        manager.removeWorktree(parsed.data.session_id);
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
      case "background_list":
      case "background_read":
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
