import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolApprovalRequest, ToolContext, ToolResult } from "../Tool.js";
import { summarizeShellExecution } from "../shared/outputCompaction.js";

const ShellInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("exec"),
    command: z.string(),
    cwd: z.string().optional(),
    timeout_ms: z.number().optional(),
  }),
  z.object({
    action: z.literal("start_background"),
    command: z.string(),
    cwd: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    action: z.literal("poll_background"),
    id: z.string(),
    tail_lines: z.number().optional(),
  }),
  z.object({
    action: z.literal("stop_background"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("list_background"),
  }),
]);

interface ShellTask {
  id: string;
  command: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "stopped";
  pid: number | null;
  createdAt: string;
  completedAt?: string;
  exitCode?: number | null;
  logFile: string;
  label?: string;
}

interface ShellTaskState {
  tasks: ShellTask[];
}

const DEFAULT_TASK_STATE: ShellTaskState = { tasks: [] };
const SENSITIVE_COMMAND_PATTERNS = [/rm\s+-rf/, /sudo\s+/i, /mkfs/i, /dd\s+if=/, />\s*\/dev\//];

export class ShellTool implements Tool {
  name = "Shell";
  aliases = ["Bash", "RunCommand", "Terminal"];
  description = "Run shell commands synchronously or as managed background tasks with poll/stop support.";
  category = "shell" as const;
  capability = "shell" as const;
  inputSchema = ShellInputSchema;

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = ShellInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "exec": {
        const workingDir = parsed.data.cwd ?? context.cwd;
        const result = Bun.spawnSync({
          cmd: ["zsh", "-lc", parsed.data.command],
          cwd: workingDir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = result.stdout.toString("utf-8").trim();
        const stderr = result.stderr.toString("utf-8").trim();
        const compacted = summarizeShellExecution({
          command: parsed.data.command,
          stdout,
          stderr,
          exitCode: result.exitCode,
          cwd: workingDir,
          mode: context.runtime?.shellCompactionMode,
        });

        return {
          success: result.exitCode === 0,
          output: compacted.output,
          error: result.exitCode === 0 ? undefined : `Command failed with exit code ${result.exitCode}`,
          truncated: compacted.truncated,
          data: {
            exitCode: result.exitCode,
            cwd: workingDir,
            command: parsed.data.command,
            commandFamily: compacted.commandFamily,
            rawOutputPath: compacted.rawOutputPath,
          },
          debug: compacted.debug,
          summary: compacted.summary,
        };
      }

      case "start_background": {
        const task = startBackgroundTask(parsed.data.command, parsed.data.cwd ?? context.cwd, parsed.data.label);
        return {
          success: true,
          output: `Started background task ${task.id}${task.label ? ` (${task.label})` : ""}`,
          data: task,
          summary: `Started background task ${task.id}`,
        };
      }

      case "poll_background": {
        const task = getTask(context.cwd, parsed.data.id);
        if (!task) {
          return { success: false, output: "", error: `Unknown background task: ${parsed.data.id}` };
        }

        const log = existsSync(task.logFile) ? readFileSync(task.logFile, "utf-8") : "";
        const tailLines = parsed.data.tail_lines ?? 40;
        const tail = log.split("\n").slice(-tailLines).join("\n").trim() || "(no output yet)";
        return {
          success: true,
          output: [
            `Task: ${task.id}`,
            `Status: ${task.status}`,
            `PID: ${task.pid ?? "n/a"}`,
            task.exitCode !== undefined ? `Exit code: ${task.exitCode ?? "n/a"}` : undefined,
            "",
            tail,
          ].filter(Boolean).join("\n"),
          data: task,
          summary: `Polled background task ${task.id}`,
        };
      }

      case "stop_background": {
        const task = getTask(context.cwd, parsed.data.id);
        if (!task) {
          return { success: false, output: "", error: `Unknown background task: ${parsed.data.id}` };
        }
        if (task.pid) {
          try {
            process.kill(task.pid);
          } catch {
            // best-effort stop
          }
        }
        task.status = "stopped";
        task.completedAt = new Date().toISOString();
        persistTask(context.cwd, task);
        return {
          success: true,
          output: `Stopped background task ${task.id}`,
          data: task,
          summary: `Stopped background task ${task.id}`,
        };
      }

      case "list_background": {
        const state = readTaskState(context.cwd);
        const output = state.tasks.length > 0
          ? state.tasks.map((task) => `${task.id} [${task.status}] ${task.command}`).join("\n")
          : "No background tasks.";
        return {
          success: true,
          output,
          data: { tasks: state.tasks },
          summary: `Listed ${state.tasks.length} background tasks`,
        };
      }
    }
  }

  buildApprovalRequest(input: unknown): ToolApprovalRequest | null {
    const parsed = ShellInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        toolName: this.name,
        toolArgs: {},
        approvalMessage: "Allow shell command execution?",
        riskLevel: "high",
        resumable: true,
      };
    }

    if (parsed.data.action === "list_background" || parsed.data.action === "poll_background") {
      return null;
    }

    if (parsed.data.action === "stop_background") {
      return {
        toolName: this.name,
        toolArgs: { id: parsed.data.id, action: parsed.data.action },
        approvalMessage: `Allow stopping background task ${parsed.data.id}?`,
        riskLevel: "medium",
        resumable: true,
      };
    }

    const command = parsed.data.command;
    const riskLevel = SENSITIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
      ? "critical"
      : "high";

    return {
      toolName: this.name,
      toolArgs: { action: parsed.data.action, command },
      approvalMessage: `Allow shell command: ${command}`,
      riskLevel,
      resumable: true,
    };
  }
}

function getTaskStorePath(cwd: string): string {
  return join(cwd, ".pebble", "shell-tasks.json");
}

function readTaskState(cwd: string): ShellTaskState {
  const storePath = getTaskStorePath(cwd);
  if (!existsSync(storePath)) {
    return { ...DEFAULT_TASK_STATE, tasks: [] };
  }

  try {
    return JSON.parse(readFileSync(storePath, "utf-8")) as ShellTaskState;
  } catch {
    return { ...DEFAULT_TASK_STATE, tasks: [] };
  }
}

function writeTaskState(cwd: string, state: ShellTaskState): void {
  const storePath = getTaskStorePath(cwd);
  const parentDir = dirname(storePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(state, null, 2), "utf-8");
}

function persistTask(cwd: string, task: ShellTask): void {
  const state = readTaskState(cwd);
  const index = state.tasks.findIndex((candidate) => candidate.id === task.id);
  if (index >= 0) {
    state.tasks[index] = task;
  } else {
    state.tasks.push(task);
  }
  writeTaskState(cwd, state);
}

function getTask(cwd: string, id: string): ShellTask | null {
  return readTaskState(cwd).tasks.find((task) => task.id === id) ?? null;
}

function startBackgroundTask(command: string, cwd: string, label?: string): ShellTask {
  const tasksDir = join(cwd, ".pebble", "shell-task-logs");
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
  }

  const id = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logFile = join(tasksDir, `${id}.log`);
  const child = spawn("zsh", ["-lc", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logStream = createWriteStream(logFile, { flags: "a" });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  const task: ShellTask = {
    id,
    command,
    cwd,
    status: "running",
    pid: child.pid ?? null,
    createdAt: new Date().toISOString(),
    logFile,
    label,
  };
  persistTask(cwd, task);

  child.on("exit", (exitCode) => {
    const nextTask: ShellTask = {
      ...task,
      status: exitCode === 0 ? "completed" : "failed",
      exitCode,
      completedAt: new Date().toISOString(),
    };
    persistTask(cwd, nextTask);
    logStream.end();
  });

  child.on("error", () => {
    const nextTask: ShellTask = {
      ...task,
      status: "failed",
      exitCode: null,
      completedAt: new Date().toISOString(),
    };
    persistTask(cwd, nextTask);
    logStream.end();
  });

  return task;
}
