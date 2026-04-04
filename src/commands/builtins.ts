import type { Command, CommandContext, CommandResult } from "./types";
import { CommandRegistry } from "./registry";
import { estimateTokens } from "../persistence/compaction.js";
import { createProjectSessionStore } from "../persistence/runtimeSessions.js";
import { findProjectRoot } from "../runtime/trust.js";

/**
 * Register all built-in commands.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register(createHelpCommand(registry));
  registry.register(createClearCommand());
  registry.register(createExitCommand());
  registry.register(createConfigCommand());
  registry.register(createPermissionsCommand());
  registry.register(createModelCommand());
  registry.register(createResumeCommand());
  registry.register(createMemoryCommand());
  registry.register(createPlanCommand());
  registry.register(createReviewCommand());
}

function getSessionStore(ctx: CommandContext) {
  return ctx.sessionStore ?? createProjectSessionStore(ctx.cwd);
}

function getActiveSession(ctx: CommandContext, requestedId?: string) {
  const store = getSessionStore(ctx);
  if (requestedId) {
    return store.loadTranscript(requestedId);
  }

  if (ctx.sessionId) {
    return store.loadTranscript(ctx.sessionId);
  }

  return store.getLatestSession();
}

function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available commands",
    type: "local",
    usage: "/help",
    modes: ["interactive"],
    execute: (_args, ctx): CommandResult => {
      const commands = registry.list(ctx);
      const lines = commands.map((cmd) => {
        const aliases = cmd.aliases?.length ? ` (${cmd.aliases.map((a) => `/${a}`).join(", ")})` : "";
        return `  /${cmd.name}${aliases.padEnd(20)} ${cmd.description}`;
      });
      return {
        success: true,
        output: `Available commands:\n${lines.join("\n")}`,
      };
    },
  };
}

function createClearCommand(): Command {
  return {
    name: "clear",
    aliases: ["cls"],
    description: "Clear the screen",
    type: "local",
    usage: "/clear",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      process.stdout.write("\x1Bc");
      return { success: true, output: "" };
    },
  };
}

function createExitCommand(): Command {
  return {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Exit the agent",
    type: "local",
    usage: "/exit",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return { success: true, output: "Goodbye!", exit: true };
    },
  };
}

function createConfigCommand(): Command {
  return {
    name: "config",
    aliases: ["settings"],
    description: "Show current configuration",
    type: "local",
    usage: "/config",
    modes: ["interactive"],
    execute: (_args, ctx): CommandResult => {
      const lines = [
        `Working directory: ${ctx.cwd}`,
        `Headless: ${ctx.headless}`,
        `Config: ${JSON.stringify(ctx.config, null, 2)}`,
        `Session ID: ${ctx.sessionId ?? "none"}`,
        `Trust level: ${ctx.trustLevel ?? "unknown"}`,
        `Extension commands: ${ctx.extensionCommandNames?.length ?? 0}`,
      ];
      return { success: true, output: lines.join("\n") };
    },
  };
}

function createPermissionsCommand(): Command {
  return {
    name: "permissions",
    aliases: ["perms", "trust"],
    description: "Show permission status",
    type: "local",
    usage: "/permissions",
    modes: ["interactive"],
    execute: (_args, ctx): CommandResult => {
      const decisions = ctx.permissionManager?.getDecisions() ?? [];
      return {
        success: true,
        output: [
          `Permission mode: ${ctx.permissionManager?.getMode() ?? "unknown"}`,
          `Persisted decisions: ${decisions.length}`,
          ...decisions.slice(0, 5).map((decision) => `  - ${decision.toolName}: ${decision.decision}`),
        ].join("\n"),
      };
    },
  };
}

function createModelCommand(): Command {
  return {
    name: "model",
    aliases: ["m"],
    description: "Show or change the current model",
    type: "local",
    usage: "/model [model-name]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      if (args) {
        (ctx.config as Record<string, unknown>).model = args;
        return { success: true, output: `Model set to: ${args}` };
      }
      return {
        success: true,
        output: `Current model: ${(ctx.config as Record<string, unknown>).model ?? "not set"}`,
      };
    },
  };
}

function createResumeCommand(): Command {
  return {
    name: "resume",
    aliases: ["continue"],
    description: "Resume the last session",
    type: "local",
    usage: "/resume [session-id]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      const requestedId = args.trim() || undefined;
      const transcript = getActiveSession(ctx, requestedId);

      if (!transcript) {
        return {
          success: true,
          output: requestedId
            ? `No session found with id: ${requestedId}`
            : "No previous session found to resume.",
        };
      }

      const preview = transcript.messages
        .slice(-3)
        .map((message) => `  ${message.role}: ${message.content.slice(0, 80)}`)
        .join("\n");

      return {
        success: true,
        output: [
          `Resumed session ${transcript.id}`,
          `Messages: ${transcript.messages.length}`,
          `Updated: ${transcript.updatedAt}`,
          preview ? `Recent context:\n${preview}` : "Recent context: (empty)",
        ].join("\n"),
        data: {
          action: "resume-session",
          sessionId: transcript.id,
        },
      };
    },
  };
}

function createMemoryCommand(): Command {
  return {
    name: "memory",
    aliases: ["mem"],
    description: "Show memory status",
    type: "local",
    usage: "/memory",
    modes: ["interactive"],
    execute: (_args, ctx): CommandResult => {
      const transcript = getActiveSession(ctx);
      if (!transcript) {
        return {
          success: true,
          output: "No persisted session memory is available yet.",
        };
      }

      const compactThreshold = Number(ctx.config.compactThreshold ?? 0);
      const tokenEstimate = estimateTokens(transcript.messages);
      const projectedCompaction = compactThreshold > 0 && tokenEstimate >= compactThreshold;

      return {
        success: true,
        output: [
          `Session memory: ${transcript.id}`,
          `Messages: ${transcript.messages.length}`,
          `Estimated tokens: ${tokenEstimate}`,
          `Compaction threshold: ${compactThreshold || "not configured"}`,
          `Compaction needed: ${projectedCompaction ? "yes" : "no"}`,
          `Updated: ${transcript.updatedAt}`,
        ].join("\n"),
      };
    },
  };
}

function createPlanCommand(): Command {
  return {
    name: "plan",
    aliases: ["think"],
    description: "Show or create a plan",
    type: "local",
    usage: "/plan [description]",
    modes: ["interactive"],
    execute: (args, _ctx): CommandResult => {
      if (args) {
        return { success: true, output: `Plan noted: ${args}` };
      }
      return { success: true, output: "No active plan. Use /plan <description> to create one." };
    },
  };
}

function createReviewCommand(): Command {
  return {
    name: "review",
    aliases: ["check"],
    description: "Review recent changes",
    type: "local",
    usage: "/review",
    modes: ["interactive"],
    trustLevels: ["trusted", "bare"],
    execute: (_args, _ctx): CommandResult => {
      const projectRoot = findProjectRoot(_ctx.cwd);
      if (!projectRoot) {
        return {
          success: true,
          output: "No project root found to review.",
        };
      }

      const repoCheck = Bun.spawnSync({
        cmd: ["git", "rev-parse", "--is-inside-work-tree"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (repoCheck.exitCode !== 0) {
        return {
          success: true,
          output: "Current project is not a git repository.",
        };
      }

      const status = Bun.spawnSync({
        cmd: ["git", "status", "--short"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const diffStat = Bun.spawnSync({
        cmd: ["git", "diff", "--stat"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stagedDiffStat = Bun.spawnSync({
        cmd: ["git", "diff", "--cached", "--stat"],
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const statusText = status.stdout.toString().trim() || "Working tree clean";
      const unstagedText = diffStat.stdout.toString().trim() || "No unstaged diff";
      const stagedText = stagedDiffStat.stdout.toString().trim() || "No staged diff";

      return {
        success: true,
        output: [
          `Repository: ${projectRoot}`,
          "Status:",
          statusText,
          "",
          "Unstaged diff summary:",
          unstagedText,
          "",
          "Staged diff summary:",
          stagedText,
        ].join("\n"),
      };
    },
  };
}
