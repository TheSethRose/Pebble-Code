import type { Command, CommandContext, CommandResult } from "./types";
import { CommandRegistry } from "./registry";
import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
} from "../constants/openrouter.js";
import {
  applyProviderDefaults,
  getBuiltinProviderDefinition,
  getProviderAuthDescription,
  getProviderCredentialLabel,
  isSupportedProvider,
  normalizeProviderId,
  providerSupportsManualCredentialEntry,
} from "../providers/catalog.js";
import { estimateTokens } from "../persistence/compaction.js";
import {
  buildSessionMemory,
  formatSessionMemory,
  isSessionMemoryStale,
} from "../persistence/memory.js";
import { createProjectSessionStore } from "../persistence/runtimeSessions.js";
import {
  getStoredProviderOAuthSession,
  getStoredProviderCredential,
  getSettingsPath,
  loadSettingsForCwd,
  saveSettingsForCwd,
  setStoredProviderCredential,
  setStoredProviderOAuthSession,
  type Settings,
} from "../runtime/config.js";
import { findProjectRoot } from "../runtime/trust.js";
import { runGitHubCopilotDeviceLogin } from "../providers/githubCopilot.js";

/**
 * Register all built-in commands.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register(createHelpCommand(registry));
  registry.register(createClearCommand());
  registry.register(createExitCommand());
  registry.register(createLoginCommand());
  registry.register(createConfigCommand());
  registry.register(createProviderCommand());
  registry.register(createPermissionsCommand());
  registry.register(createModelCommand());
  registry.register(createResumeCommand());
  registry.register(createMemoryCommand());
  registry.register(createPlanCommand());
  registry.register(createReviewCommand());
  registry.register(createSidebarCommand());
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

function loadProjectSettings(ctx: CommandContext): Settings {
  return loadSettingsForCwd(ctx.cwd);
}

function saveProjectSettings(ctx: CommandContext, settings: Settings): string {
  return saveSettingsForCwd(ctx.cwd, settings);
}

function ensureProviderDefaults(settings: Settings): Settings {
  const withDefaults = applyProviderDefaults(settings);
  const activeCredential = getStoredProviderCredential(withDefaults, withDefaults.provider);
  if (withDefaults.provider === OPENROUTER_PROVIDER_ID) {
    return {
      ...withDefaults,
      apiKey: activeCredential,
      model: withDefaults.model?.trim() || OPENROUTER_DEFAULT_MODEL,
      baseUrl: withDefaults.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
    };
  }

  return {
    ...withDefaults,
    apiKey: activeCredential,
    model: withDefaults.model?.trim(),
    baseUrl: withDefaults.baseUrl?.trim(),
  };
}

function getCurrentProviderId(ctx: CommandContext): string {
  const provider = typeof ctx.config.provider === "string"
    ? ctx.config.provider
    : loadProjectSettings(ctx).provider;
  return normalizeProviderId(provider);
}

function createConfigUpdatedResult(output: string, settingsPath: string): CommandResult {
  return {
    success: true,
    output,
    data: {
      action: "config-updated",
      settingsPath,
    },
  };
}

function createHelpCommand(registry: CommandRegistry): Command {
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

function createClearCommand(): Command {
  return {
    name: "clear",
    aliases: ["cls"],
    description: "Clear the conversation",
    type: "local",
    usage: "/clear",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return { success: true, output: "", data: { action: "clear" } };
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
    description: "Open settings menu",
    type: "ui",
    usage: "/config",
    modes: ["interactive"],
    execute: (_args, _ctx): CommandResult => {
      return { success: true, output: "", data: { action: "open-settings", defaultTab: "config" } };
    },
  };
}

function createProviderCommand(): Command {
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

function createLoginCommand(): Command {
  return {
    name: "login",
    aliases: ["auth"],
    description: "Configure authentication for a provider",
    type: "local",
    usage: "/login [provider] <credential>",
    modes: ["interactive"],
    execute: async (args, ctx): Promise<CommandResult> => {
      const trimmed = args.trim();
      if (!trimmed) {
        return {
          success: true,
          output: "",
          data: { action: "open-settings", defaultTab: "api-key" },
        };
      }

      const tokens = trimmed.split(/\s+/);
      const currentProvider = getCurrentProviderId(ctx);
      const providerOnlyInvocation = tokens.length === 1 && isSupportedProvider(tokens[0]);
      const explicitProvider = providerOnlyInvocation
        ? normalizeProviderId(tokens[0])
        : tokens.length > 1
          ? normalizeProviderId(tokens[0])
          : currentProvider;
      const apiKey = providerOnlyInvocation
        ? ""
        : tokens.length > 1
          ? tokens.slice(1).join(" ").trim()
          : tokens[0] ?? "";

      if (!isSupportedProvider(explicitProvider)) {
        return {
          success: true,
          output: `Unsupported provider: ${explicitProvider}. Choose a built-in provider from /provider or configure an extension provider instead.`,
        };
      }

      const definition = getBuiltinProviderDefinition(explicitProvider);
      if (!definition) {
        return {
          success: true,
          output: `Unsupported provider: ${explicitProvider}.`,
        };
      }

      if (definition.authKind === "oauth" && explicitProvider === "github-copilot" && (!apiKey || providerOnlyInvocation)) {
        const currentSettings = loadProjectSettings(ctx);
        const switchingProvider = explicitProvider !== normalizeProviderId(currentSettings.provider);
        const writeLine = (line: string) => {
          try {
            process.stdout.write(`${line}\n`);
          } catch {
            // Best-effort informational output only.
          }
        };

        const oauth = await runGitHubCopilotDeviceLogin({ writeLine });
        const nextSettings = ensureProviderDefaults(
          setStoredProviderOAuthSession(
            {
              ...currentSettings,
              provider: explicitProvider,
              model: switchingProvider ? undefined : currentSettings.model,
              baseUrl: switchingProvider ? undefined : currentSettings.baseUrl,
            },
            explicitProvider,
            {
              accessToken: oauth.githubToken,
              tokenType: "github-device",
            },
          ),
        );
        const settingsPath = saveProjectSettings(ctx, nextSettings);
        return createConfigUpdatedResult(
          `Saved OAuth session for ${nextSettings.provider} to ${settingsPath}. GitHub Copilot runtime wiring is enabled, but live credential smoke tests are still pending.`,
          settingsPath,
        );
      }

      if (!providerSupportsManualCredentialEntry(definition)) {
        const existingOauth = getStoredProviderOAuthSession(loadProjectSettings(ctx), explicitProvider);
        const configuredHint = existingOauth ? " An OAuth session is already saved for this provider." : "";
        return {
          success: true,
          output: `${definition.label} cannot be configured with a pasted ${getProviderCredentialLabel(definition)} in Pebble.${configuredHint} ${getProviderAuthDescription(definition)}`,
        };
      }

      if (!apiKey) {
        return { success: true, output: `Usage: /login [provider] <${getProviderCredentialLabel(definition)}>` };
      }

      const currentSettings = loadProjectSettings(ctx);
      const persistedProvider = normalizeProviderId(currentSettings.provider);
      const switchingProvider = explicitProvider !== persistedProvider;
      const nextSettings = ensureProviderDefaults(
        setStoredProviderCredential(
          {
            ...currentSettings,
            provider: explicitProvider,
            model: switchingProvider ? undefined : currentSettings.model,
            baseUrl: switchingProvider ? undefined : currentSettings.baseUrl,
          },
          explicitProvider,
          apiKey,
        ),
      );
      const settingsPath = saveProjectSettings(ctx, nextSettings);
      const implementationNote = definition.implemented
        ? ""
        : ` ${definition.label} is still cataloged-only, so live execution remains unimplemented or un-smoke-tested.`;
      return createConfigUpdatedResult(
        `Saved ${getProviderCredentialLabel(definition)} for ${nextSettings.provider} to ${settingsPath}.${implementationNote}`,
        settingsPath,
      );
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
      if (args.trim()) {
        const settings = ensureProviderDefaults({
          ...loadProjectSettings(ctx),
          model: args.trim(),
        });
        const settingsPath = saveProjectSettings(ctx, settings);
        return createConfigUpdatedResult(
          `Model set to ${args.trim()}. Saved to ${settingsPath}.`,
          settingsPath,
        );
      }

      return {
        success: true,
        output: "",
        data: { action: "open-settings", defaultTab: "model" },
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
    description: "Show, refresh, or clear session memory",
    type: "local",
    usage: "/memory [refresh|clear]",
    modes: ["interactive"],
    execute: (args, ctx): CommandResult => {
      const action = args.trim().toLowerCase();
      if (action && action !== "refresh" && action !== "clear" && action !== "status") {
        return {
          success: true,
          output: "Usage: /memory [refresh|clear]",
        };
      }

      const store = getSessionStore(ctx);
      const transcript = getActiveSession(ctx);
      if (!transcript) {
        return {
          success: true,
          output: "No persisted session memory is available yet.",
        };
      }

      if (action === "clear") {
        store.clearMemory(transcript.id);
        return {
          success: true,
          output: `Cleared session memory for ${transcript.id}.`,
        };
      }

      const compactThreshold = Number(ctx.config.compactThreshold ?? 0);
      const tokenEstimate = estimateTokens(transcript.messages);
      const projectedCompaction = compactThreshold > 0 && tokenEstimate >= compactThreshold;
      const shouldRefresh = action === "refresh" || isSessionMemoryStale(transcript.memory, transcript);
      const memory = shouldRefresh
        ? store.updateMemory(transcript.id, buildSessionMemory(transcript)).memory
        : transcript.memory;

      if (!memory) {
        return {
          success: true,
          output: `Session ${transcript.id} has no conversation history to summarize yet.`,
        };
      }

      return {
        success: true,
        output: [
          shouldRefresh ? `Session memory refreshed for ${transcript.id}.` : undefined,
          formatSessionMemory(memory, transcript.id),
          "",
          "Compaction status:",
          `Messages in transcript: ${transcript.messages.length}`,
          `Estimated tokens in transcript: ${tokenEstimate}`,
          `Compaction threshold: ${compactThreshold || "not configured"}`,
          `Compaction needed: ${projectedCompaction ? "yes" : "no"}`,
          `Updated: ${transcript.updatedAt}`,
        ].filter(Boolean).join("\n"),
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

function createSidebarCommand(): Command {
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
