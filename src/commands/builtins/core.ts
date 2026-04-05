import type { Command, CommandResult } from "../types.js";
import { ensureProjectInit, formatInitFlowReport } from "../../runtime/initFlow.js";

export function createHelpCommand(): Command {
  return {
    name: "help",
    aliases: ["h", "?"],
    description: "Show keyboard shortcuts",
    type: "local",
    usage: "/help",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return {
        success: true,
        output: "",
        data: { action: "show-keybindings" },
      };
    },
  };
}

export function createClearCommand(): Command {
  return {
    name: "clear",
    aliases: ["cls", "new"],
    description: "Clear the conversation",
    type: "local",
    usage: "/clear",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return { success: true, output: "", data: { action: "clear" } };
    },
  };
}

export function createExitCommand(): Command {
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

export function createConfigCommand(): Command {
  return {
    name: "config",
    aliases: ["settings"],
    description: "Open settings menu",
    type: "ui",
    usage: "/config",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return { success: true, output: "", data: { action: "open-settings", defaultTab: "config" } };
    },
  };
}

export function createInitCommand(): Command {
  return {
    name: "init",
    aliases: ["setup"],
    description: "Inspect and seed safe Pebble project defaults",
    type: "local",
    usage: "/init [status]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      const mode = args.trim().toLowerCase();
      const report = ensureProjectInit(ctx.cwd, ctx, {
        writeProjectSettings: mode !== "status",
      });

      return {
        success: true,
        output: formatInitFlowReport(report),
      };
    },
  };
}

export function createProviderCommand(): Command {
  return {
    name: "provider",
    aliases: ["p"],
    description: "Switch AI provider",
    type: "ui",
    usage: "/provider",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return { success: true, output: "", data: { action: "open-settings", defaultTab: "provider" } };
    },
  };
}

export function createSidebarCommand(): Command {
  return {
    name: "sidebar",
    aliases: [],
    description: "Toggle the session sidebar",
    type: "local",
    usage: "/sidebar",
    modes: ["interactive"],
    trustLevels: ["trusted", "bare"],
    execute: (_args, _ctx): CommandResult => {
      return {
        success: true,
        output: "",
        data: { action: "sidebar-toggle" },
      };
    },
  };
}

export function createVoiceCommand(): Command {
  return {
    name: "voice",
    aliases: [],
    description: "Toggle voice mode",
    type: "local",
    usage: "/voice",
    modes: ["interactive"],
    execute: async (_args, _ctx) => {
      return {
        success: true,
        output: "",
        data: { action: "open-settings", defaultTab: "voice" },
      };
    },
  };
}