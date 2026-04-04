import type { Command, CommandContext, CommandResult } from "./types";
import { CommandRegistry } from "./registry";

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

function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available commands",
    type: "local",
    usage: "/help",
    execute: (_args, _ctx): CommandResult => {
      const commands = registry.list();
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
    execute: (_args, ctx): CommandResult => {
      const lines = [
        `Working directory: ${ctx.cwd}`,
        `Headless: ${ctx.headless}`,
        `Config: ${JSON.stringify(ctx.config, null, 2)}`,
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
    execute: (_args, _ctx): CommandResult => {
      return {
        success: true,
        output: "Permission system active. Use /config to change modes.",
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
    execute: (_args, _ctx): CommandResult => {
      return {
        success: true,
        output: "Session resume not yet implemented (Phase 7)",
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
    execute: (_args, _ctx): CommandResult => {
      return {
        success: true,
        output: "Memory system not yet implemented (Phase 7)",
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
    execute: (_args, _ctx): CommandResult => {
      return {
        success: true,
        output: "Review system not yet implemented",
      };
    },
  };
}
