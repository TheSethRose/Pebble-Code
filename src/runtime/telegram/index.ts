import { getVersionString } from "../../build/buildInfo.js";
import { getFeatureSummary } from "../../build/featureFlags.js";
import { registerBuiltinCommands } from "../../commands/builtins.js";
import { CommandRegistry } from "../../commands/registry.js";
import {
  composeSkillInstructions,
  getDefaultExtensionDirs,
  loadRuntimeIntegrations,
  reportExtensionStatus,
} from "../../extensions/loaders.js";
import { resolveRuntimeProvider } from "../../providers/runtime.js";
import type { Skill } from "../../extensions/contracts.js";
import {
  cleanupDeletedSessionWorktrees,
  createProjectSessionStore,
} from "../../persistence/runtimeSessions.js";
import { buildRuntimeConfig, getConfigDir, type Settings } from "../config.js";
import { createHookRegistry } from "../hooks.js";
import { formatInstructions, formatPromptFiles, loadPromptFiles } from "../instructions.js";
import { PermissionManager } from "../permissionManager.js";
import { createTelegramBot, wireTelegramBot } from "./bot.js";
import { syncTelegramNativeCommands } from "./commands.js";
import { createTelegramLogger } from "./logger.js";
import { runTelegramMonitor } from "./monitor.js";
import { TelegramRouter } from "./router.js";
import { TelegramStateStore } from "./state.js";
import type {
  ResolvedTelegramRuntimeConfig,
  TelegramBotIdentity,
  TelegramRuntimeOverrides,
} from "./types.js";

export interface TelegramRuntimeOptions extends TelegramRuntimeOverrides {
  logStartup?: boolean;
}

export async function runTelegram(options: TelegramRuntimeOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const shouldLogStartup = options.logStartup ?? true;

  if (shouldLogStartup) {
    console.error(getVersionString());
    console.error(getFeatureSummary());
    console.error(`Mode: telegram (${options.mode ?? "settings/default"})`);
    console.error(`Working directory: ${cwd}`);
  }

  const runtimeConfig = buildRuntimeConfig(cwd);
  const settings = runtimeConfig.settings;
  const telegramConfig = resolveTelegramRuntimeConfig(settings, options);
  const logger = createTelegramLogger(getConfigDir(runtimeConfig.cwd));

  logger.info("Telegram runtime booting", {
    cwd,
    projectRoot: runtimeConfig.trust.projectRoot,
    requestedMode: options.mode ?? "settings/default",
    transportMode: telegramConfig.mode,
    logPath: logger.logPath,
  });

  if (shouldLogStartup) {
    console.error(`Trust level: ${runtimeConfig.trust.level}`);
    console.error(`Project root: ${runtimeConfig.trust.projectRoot}`);
    console.error(`Telegram log: ${logger.logPath}`);
  }

  const permissionManager = new PermissionManager({
    mode: settings.permissionMode,
    projectRoot: runtimeConfig.trust.projectRoot,
  });

  const instructions = formatInstructions(runtimeConfig.instructions);
  const promptFiles = loadPromptFiles(runtimeConfig.trust.projectRoot);
  const promptContent = formatPromptFiles(promptFiles);

  const extensionDirs = getDefaultExtensionDirs(cwd);
  const integrations = await loadRuntimeIntegrations(extensionDirs, {
    mcpServers: runtimeConfig.settings.mcpServers,
  });

  if (shouldLogStartup) {
    reportExtensionStatus(integrations.results);
  }

  logger.info("Telegram integrations loaded", {
    commandCount: integrations.commands.length,
    toolCount: integrations.tools.length,
    providerCount: integrations.providers.length,
    skillCount: integrations.skills.length,
    mcpServerCount: integrations.mcpServers.length,
  });

  const systemPrompt = mergeRuntimeInstructions(promptContent, instructions, integrations.skills);
  const resolvedProvider = resolveRuntimeProvider(settings, {}, integrations.providers);
  logger.info("Telegram provider resolved", {
    providerId: resolvedProvider.providerId,
    providerLabel: resolvedProvider.providerLabel,
    model: resolvedProvider.model,
    transportMode: telegramConfig.mode,
  });

  if (shouldLogStartup) {
    console.error(`Provider: ${resolvedProvider.providerLabel} (${resolvedProvider.model})`);
    console.error(`Telegram transport: ${telegramConfig.mode}`);
  }

  const hookRegistry = createHookRegistry(integrations.extensions);
  const sessionStore = createProjectSessionStore(runtimeConfig.cwd);
  cleanupDeletedSessionWorktrees(sessionStore, runtimeConfig.cwd);
  const state = new TelegramStateStore(runtimeConfig.trust.projectRoot);
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);
  registry.registerMany(integrations.commands);

  const bot = createTelegramBot(telegramConfig.botToken);
  const botIdentity = await resolveTelegramBotIdentity(bot, telegramConfig);
  const router = new TelegramRouter({
    cwd: runtimeConfig.cwd,
    trustLevel: runtimeConfig.trust.level,
    bot,
    botIdentity,
    telegramConfig,
    sessionStore,
    state,
    registry,
    permissionManager,
    extensionCommandNames: integrations.commands.map((command) => command.name),
    extensionCommands: integrations.commands,
    extensionTools: integrations.tools,
    extensionProviders: integrations.providers,
    loadedSkills: integrations.skills,
    loadedMcpServers: integrations.mcpServers,
    extensionDirs,
    hookRegistry,
    systemPrompt,
    logger,
  });
  const wiredBot = wireTelegramBot(bot, router);

  if (telegramConfig.syncCommandsOnStart) {
    await syncTelegramNativeCommands(wiredBot, registry);
    logger.info("Telegram native commands synchronized", {
      commandCount: registry.list().filter((command) => command.modes?.includes("telegram") || !command.modes?.length).length,
    });
  }

  logger.info("Telegram bot authenticated", {
    botId: botIdentity.id,
    botUsername: botIdentity.username ?? "unknown",
  });

  if (shouldLogStartup) {
    console.error(`Telegram bot: @${botIdentity.username ?? "unknown"} (${botIdentity.id})`);
  }

  try {
    await runTelegramMonitor({
      bot: wiredBot,
      config: telegramConfig,
      state,
      signal: options.signal,
      log: (message, context) => {
        logger.info(message, context);
        console.error(message);
      },
    });
    logger.info("Telegram runtime stopped cleanly");
    return 0;
  } catch (error) {
    logger.error("Telegram runtime failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`Telegram runtime failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function resolveTelegramBotIdentity(
  bot: ReturnType<typeof createTelegramBot>,
  config: ResolvedTelegramRuntimeConfig,
): Promise<TelegramBotIdentity> {
  await bot.init();
  const me = bot.botInfo;
  const actualId = String(me.id);
  if (config.botId && config.botId !== actualId) {
    throw new Error(`Configured telegram.botId (${config.botId}) does not match the authenticated bot (${actualId}).`);
  }

  return {
    id: actualId,
    username: config.botUsername ?? me.username,
  };
}

export function resolveTelegramRuntimeConfig(
  settings: Settings,
  overrides: TelegramRuntimeOverrides = {},
): ResolvedTelegramRuntimeConfig {
  const telegram = {
    ...(settings.telegram ?? {}),
    ...(overrides.botToken ? { botToken: overrides.botToken } : {}),
    ...(overrides.botId ? { botId: overrides.botId } : {}),
    ...(overrides.botUsername ? { botUsername: overrides.botUsername } : {}),
    ...(overrides.mode ? { mode: overrides.mode } : {}),
    ...(overrides.allowedUserIds ? { allowedUserIds: overrides.allowedUserIds } : {}),
    ...(overrides.allowedChatIds ? { allowedChatIds: overrides.allowedChatIds } : {}),
    ...(overrides.webhookUrl ? { webhookUrl: overrides.webhookUrl } : {}),
    ...(overrides.webhookHost ? { webhookHost: overrides.webhookHost } : {}),
    ...(typeof overrides.webhookPort === "number" ? { webhookPort: overrides.webhookPort } : {}),
    ...(overrides.webhookPath ? { webhookPath: overrides.webhookPath } : {}),
    ...(overrides.webhookSecret ? { webhookSecret: overrides.webhookSecret } : {}),
  };

  if (!telegram.botToken) {
    throw new Error("Telegram runtime requires telegram.botToken or PEBBLE_TELEGRAM_BOT_TOKEN.");
  }

  return {
    ...telegram,
    botToken: telegram.botToken,
    mode: telegram.mode ?? "polling",
    allowedUserIds: telegram.allowedUserIds ?? [],
    allowedChatIds: telegram.allowedChatIds ?? [],
    handleGroupMentionsOnly: telegram.handleGroupMentionsOnly ?? true,
    streamEdits: telegram.streamEdits ?? true,
    editDebounceMs: telegram.editDebounceMs ?? 750,
    maxMessageChars: telegram.maxMessageChars ?? 4000,
    syncCommandsOnStart: telegram.syncCommandsOnStart ?? true,
    persistOffsets: telegram.persistOffsets ?? true,
    pollingTimeoutSeconds: telegram.pollingTimeoutSeconds ?? 20,
    webhookPath: telegram.webhookPath ?? "/telegram/webhook",
    webhookHost: telegram.webhookHost ?? "127.0.0.1",
    webhookPort: telegram.webhookPort ?? 8788,
  };
}

function mergeRuntimeInstructions(promptContent: string, baseInstructions: string, skills: Skill[]): string {
  const skillInstructions = composeSkillInstructions(skills);
  return [promptContent.trim(), baseInstructions.trim(), skillInstructions.trim()].filter(Boolean).join("\n\n");
}
