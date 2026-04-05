import type { Command, CommandResult } from "../types.js";
import {
  getBuiltinProviderDefinition,
  isSupportedProvider,
  normalizeProviderId,
} from "../../providers/catalog.js";
import { ensureProjectInit, formatInitFlowReport } from "../../runtime/initFlow.js";
import {
  createConfigUpdatedResult,
  ensureProviderDefaults,
  loadProjectSettings,
  saveProjectSettings,
} from "./shared.js";

export function createHelpCommand(): Command {
  return {
    name: "help",
    aliases: ["h", "?"],
    description: "Show keyboard shortcuts",
    type: "local",
    usage: "/help",
    modes: ["interactive", "telegram"],
    execute: (_args, ctx): CommandResult => {
      if (ctx.mode === "telegram") {
        return {
          success: true,
          output: [
            "Pebble Telegram commands:",
            "/start — show Telegram runtime status",
            "/help — show this help",
            "/new — start a fresh session for this chat/topic",
            "/sessions — list this chat's recent sessions",
            "/resume <session-id> — bind this chat/topic to an earlier session",
            "/model [model-id] — show or update the active model",
            "/provider [provider-id] — show or update the active provider",
            "/compact — compact the current bound session",
            "/status — show Telegram runtime state",
            "/approve <id> / /deny <id> — resolve a pending approval",
            "/stop — cancel the active run for this chat/topic",
          ].join("\n"),
        };
      }

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
    description: "Show or change the active AI provider",
    type: "local",
    usage: "/provider [provider-id]",
    modes: ["interactive", "telegram"],
    execute: (args, ctx): CommandResult => {
      const requestedProvider = args.trim();
      if (!requestedProvider) {
        if (ctx.mode === "telegram") {
          const providerId = typeof ctx.config.provider === "string"
            ? ctx.config.provider
            : loadProjectSettings(ctx).provider;
          const providerLabel = typeof ctx.config.providerLabel === "string"
            ? ctx.config.providerLabel
            : getBuiltinProviderDefinition(providerId)?.label ?? providerId ?? "unknown";
          return {
            success: true,
            output: [
              `Current provider: ${providerLabel} (${providerId ?? "unknown"})`,
              "Usage: /provider <provider-id>",
            ].join("\n"),
          };
        }

        return { success: true, output: "", data: { action: "open-settings", defaultTab: "provider" } };
      }

      const providerId = normalizeProviderId(requestedProvider);
      if (!isSupportedProvider(providerId)) {
        return {
          success: true,
          output: `Unsupported provider: ${providerId}. Choose a built-in provider or configure an extension provider in the TUI settings.`,
        };
      }

      const currentSettings = loadProjectSettings(ctx);
      const switchingProvider = providerId !== normalizeProviderId(currentSettings.provider);
      const nextSettings = ensureProviderDefaults({
        ...currentSettings,
        provider: providerId,
        model: switchingProvider ? undefined : currentSettings.model,
        baseUrl: switchingProvider ? undefined : currentSettings.baseUrl,
      });
      const settingsPath = saveProjectSettings(ctx, nextSettings);
      const providerLabel = getBuiltinProviderDefinition(providerId)?.label ?? providerId;

      return createConfigUpdatedResult(
        `Provider set to ${providerLabel} (${providerId}). Saved to ${settingsPath}.`,
        settingsPath,
      );
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