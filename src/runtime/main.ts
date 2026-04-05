/**
 * Runtime main entry point.
 *
 * This is the full runtime boot — called after fast-path checks pass.
 * It initializes config, trust, providers, extensions, and starts
 * either the interactive REPL or headless mode.
 */

import { join } from "node:path";
import { BUILD_INFO, getVersionString } from "../build/buildInfo.js";
import { getFeatureSummary } from "../build/featureFlags.js";
import { buildRuntimeConfig } from "./config.js";
import { PermissionManager } from "./permissionManager.js";
import { WorktreeManager } from "./worktrees.js";
import { createHookRegistry, type HookContext, type HookRegistry } from "./hooks.js";
import { formatInstructions, loadPromptFiles, formatPromptFiles } from "./instructions.js";
import {
  cleanupDeletedSessionWorktrees,
  createProjectSessionStore,
  createOrResumeSession,
  resolveInteractiveStartupSessionId,
  compactSessionIfNeeded,
  transcriptToConversation,
  ensureFreshSessionMemory,
  engineMessageToTranscriptMessage,
  failPendingApprovalsForResume,
} from "../persistence/runtimeSessions.js";
import { getSettingsPath } from "./config.js";
import {
  composeSkillInstructions,
  getDefaultExtensionDirs,
  loadRuntimeIntegrations,
  reportExtensionStatus,
  type RuntimeIntegrations,
} from "../extensions/loaders.js";
import type { Command, CommandContext } from "../commands/types.js";
import type { StreamEvent, EngineState } from "../engine/types.js";
import type { Tool } from "../tools/Tool.js";
import { resolveRuntimeProvider, type RuntimeProviderResolution } from "../providers/runtime.js";
import { createHeadlessReporter, type HeadlessFormat } from "./reporters.js";

export type { HeadlessFormat } from "./reporters.js";

type StartRepl = (context: CommandContext) => Promise<number>;

let startReplForTesting: StartRepl | null = null;

export interface RuntimeOptions {
  /** Run in headless/print mode */
  headless?: boolean;
  /** Input prompt for headless mode */
  prompt?: string;
  /** Session ID to resume */
  resume?: string;
  /** Working directory */
  cwd?: string;
  /** Model to use */
  model?: string;
  /** Provider to use */
  provider?: string;
  /** Headless output format */
  format?: string;
  /** Abort signal */
  signal?: AbortSignal;
}

export function setStartReplForTesting(startRepl: StartRepl | null): void {
  startReplForTesting = startRepl;
}

export async function run(options: RuntimeOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const shouldLogStartup = options.headless ?? false;

  // Phase 1: Log startup
  if (shouldLogStartup) {
    console.error(getVersionString());
    console.error(getFeatureSummary());
    console.error(`Mode: ${options.headless ? "headless" : "interactive"}`);
    console.error(`Working directory: ${cwd}`);
  }

  // Phase 2: Initialize config layer
  const config = buildRuntimeConfig(cwd);
  if (shouldLogStartup) {
    console.error(`Trust level: ${config.trust.level}`);
    console.error(`Project root: ${config.trust.projectRoot}`);
  }

  // Phase 3: Initialize trust system
  const permissionManager = new PermissionManager({
    mode: config.settings.permissionMode,
    projectRoot: config.trust.projectRoot,
  });

  // Phase 4: Load repository instructions and prompt files
  const instructions = formatInstructions(config.instructions);
  if (shouldLogStartup && instructions) {
    console.error(`Loaded ${config.instructions.length} instruction file(s)`);
  }

  const promptFiles = loadPromptFiles(config.trust.projectRoot);
  const promptContent = formatPromptFiles(promptFiles);
  if (shouldLogStartup && promptFiles.length > 0) {
    console.error(`Loaded ${promptFiles.length} prompt file(s) from .pebble/prompts/`);
  }

  const extensionDirs = getDefaultExtensionDirs(cwd);
  const integrations = await loadRuntimeIntegrations(extensionDirs, {
    mcpServers: config.settings.mcpServers,
  });
  if (shouldLogStartup) {
    reportExtensionStatus(integrations.results);
  }

  const resolvedProvider = resolveRuntimeProvider(
    config.settings,
    {
      provider: options.provider,
      model: options.model,
    },
    integrations.providers,
  );
  const extensionCommandNames = integrations.commands.map((command) => command.name);
  const hookRegistry = createHookRegistry(integrations.extensions);
  const systemPrompt = mergeRuntimeInstructions(promptContent, instructions, integrations.skills);

  if (shouldLogStartup) {
    const worktreeManager = new WorktreeManager({ repoRoot: config.trust.projectRoot });
    const worktreeAvailability = worktreeManager.getAvailability();
    console.error(`Provider: ${resolvedProvider.providerLabel} (${resolvedProvider.model})`);
    console.error(`Extensions: ${integrations.extensions.length} plugin(s), ${integrations.skills.length} skill(s), ${integrations.mcpServers.length} MCP server(s), ${integrations.providers.length} provider(s)`);
    console.error(`Worktree root: ${join(config.trust.projectRoot, ".pebble", "worktrees")}`);
    console.error(
      `Worktree support: ${worktreeAvailability.available ? "available" : `unavailable (${worktreeAvailability.reason ?? "unknown reason"})`}`,
    );
  }

  // Phase 6: Start the appropriate mode
  if (options.headless) {
    return runHeadless(
      options,
      config,
      permissionManager,
      systemPrompt,
      resolvedProvider,
      integrations,
      extensionCommandNames,
      hookRegistry,
      extensionDirs,
    );
  }

  return runInteractive(
    options,
    config,
    permissionManager,
    systemPrompt,
    resolvedProvider,
    integrations,
    integrations.commands,
    extensionCommandNames,
    hookRegistry,
    extensionDirs,
  );
}

async function runHeadless(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  systemPrompt: string,
  resolvedProvider: RuntimeProviderResolution,
  integrations: RuntimeIntegrations,
  extensionCommandNames: string[],
  hookRegistry: HookRegistry,
  extensionDirs: string[],
): Promise<number> {
  if (!options.prompt) {
    console.error("Error: headless mode requires --prompt");
    return 1;
  }

  const format = normalizeHeadlessFormat(options.format);
  const reporter = createHeadlessReporter(format);

  console.error("Headless mode: processing prompt...");
  console.error(`Permission mode: ${config.settings.permissionMode}`);
  console.error(`Output format: ${format}`);
  console.error(`Instructions: ${systemPrompt ? "loaded" : "none"}`);
  if (extensionCommandNames.length > 0) {
    console.error(`Extension commands available: ${extensionCommandNames.join(", ")}`);
  }

  // Initialize engine for headless execution
  const { createMvpTools } = await import("../tools/orchestration.js");
  const { query } = await import("../engine/query.js");

  const tools = createMvpTools(integrations.tools);
  const sessionStore = createProjectSessionStore(config.cwd);
  cleanupDeletedSessionWorktrees(sessionStore, config.cwd);
  const session = createOrResumeSession(sessionStore, options.resume);
  failPendingApprovalsForResume(sessionStore, permissionManager, session.id);

  let sessionStarted = false;
  try {
    await hookRegistry.fire("session:start", { sessionId: session.id });
    sessionStarted = true;

    if (options.prompt) {
      sessionStore.appendMessage(session.id, {
        role: "user",
        content: options.prompt,
        timestamp: new Date().toISOString(),
      });
    }

    const compactedTranscript = compactSessionIfNeeded(
      sessionStore,
      session.id,
      config.settings.compactThreshold,
    ) ?? sessionStore.loadTranscript(session.id) ?? session;
    const inputTranscript = ensureFreshSessionMemory(sessionStore, session.id) ?? compactedTranscript;
    const conversation = transcriptToConversation(inputTranscript, config.settings.compactThreshold);

    reporter.emitInit(session.id, resolvedProvider.provider.model, resolvedProvider.provider.name, config.cwd);
    reporter.emitUserPrompt(options.prompt);

    await hookRegistry.fire("turn:before", { sessionId: session.id });

    const result = await query(
      conversation,
      {
        provider: resolvedProvider.provider,
        tools,
        maxTurns: config.settings.maxTurns ?? 50,
        systemPrompt: systemPrompt || undefined,
        signal: options.signal,
        permissionManager,
        cwd: config.cwd,
        shellCompactionMode: config.settings.shellCompactionMode,
        sessionStore,
        getSessionId: () => session.id,
        extensionDirs,
        skills: integrations.skills,
        mcpServers: integrations.mcpServers,
        onLifecycleEvent: (event, context) => hookRegistry.fire(event, toHookContext(context)),
        onEvent: (event: StreamEvent) => reporter.emitStreamEvent(event),
      },
    );

    await hookRegistry.fire("turn:after", { sessionId: session.id });

    const newMessages = result.messages.slice(conversation.length);
    for (const message of newMessages) {
      const transcriptMessage = engineMessageToTranscriptMessage(message);
      if (transcriptMessage) {
        sessionStore.appendMessage(session.id, transcriptMessage);
      }
    }

    const postRunCompactedTranscript = compactSessionIfNeeded(
      sessionStore,
      session.id,
      config.settings.compactThreshold,
    );
    sessionStore.updateMetadata(session.id, {
      lastHeadlessRun: {
        format,
        providerId: resolvedProvider.providerId,
        providerLabel: resolvedProvider.providerLabel,
        model: resolvedProvider.model,
        prompt: options.prompt ?? null,
        success: result.success,
        status: mapEngineStateToResultStatus(result.state),
        usage: result.usage,
        messageCount: postRunCompactedTranscript?.messages.length ?? result.messages.length,
        completedAt: new Date().toISOString(),
      },
    });

    sessionStore.updateStatus(session.id, result.success ? "completed" : result.state === "interrupted" ? "interrupted" : "error");

    if (format === "json-stream") {
      reporter.emitReplayMessages(newMessages);
      reporter.emitResult(
        mapEngineStateToResultStatus(result.state),
        result.success ? "Query completed successfully" : result.error ?? "Query failed",
        session.id,
        {
          success: result.success,
          usage: result.usage,
          messageCount: postRunCompactedTranscript?.messages.length ?? result.messages.length,
        },
      );
    } else if (format === "json") {
      reporter.emitResult(
        mapEngineStateToResultStatus(result.state),
        result.success ? "Query completed successfully" : result.error ?? "Query failed",
        session.id,
        {
          success: result.success,
          usage: result.usage,
          messages: result.messages,
        },
      );
    } else {
      reporter.printText(newMessages, result.error);
    }

    return result.success ? 0 : 1;
  } catch (error) {
    sessionStore.updateStatus(session.id, "error");

    const message = error instanceof Error ? error.message : String(error);
    sessionStore.updateMetadata(session.id, {
      lastHeadlessRun: {
        format,
        providerId: resolvedProvider.providerId,
        providerLabel: resolvedProvider.providerLabel,
        model: resolvedProvider.model,
        prompt: options.prompt ?? null,
        success: false,
        status: "error",
        error: message,
        completedAt: new Date().toISOString(),
      },
    });
    await hookRegistry.fire("error", {
      sessionId: session.id,
      error: error instanceof Error ? error : new Error(message),
    });
    if (format === "text") {
      console.error(message);
    } else {
      reporter.emitResult("error", message, session.id);
    }

    return 1;
  } finally {
    if (sessionStarted) {
      await hookRegistry.fire("session:end", { sessionId: session.id });
    }
  }
}

async function runInteractive(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  systemPrompt: string,
  resolvedProvider: RuntimeProviderResolution,
  integrations: RuntimeIntegrations,
  extensionCommands: Command[],
  extensionCommandNames: string[],
  hookRegistry: HookRegistry,
  extensionDirs: string[],
): Promise<number> {
  // Import Ink REPL dynamically to avoid blocking fast paths
  const startREPL = startReplForTesting ?? (await import("../ui/App.js")).startREPL;
  const sessionStore = createProjectSessionStore(config.cwd);

  cleanupDeletedSessionWorktrees(sessionStore, config.cwd);

  const initialSessionId = resolveInteractiveStartupSessionId(
    sessionStore,
    config.settings.worktreeStartupMode,
    options.resume,
  );

  const context = {
    cwd: config.cwd,
    headless: false,
    config: {
      trust: config.trust.level,
      permissionMode: config.settings.permissionMode,
      provider: resolvedProvider.providerId,
      providerLabel: resolvedProvider.providerLabel,
      model: resolvedProvider.model,
      baseUrl: resolvedProvider.baseUrl,
      apiKeyConfigured: resolvedProvider.apiKeyConfigured,
      apiKeySource: resolvedProvider.apiKeySource,
      settingsPath: getSettingsPath(config.cwd),
      compactThreshold: config.settings.compactThreshold,
      shellCompactionMode: config.settings.shellCompactionMode,
      worktreeStartupMode: config.settings.worktreeStartupMode,
    },
    sessionStore,
    sessionId: initialSessionId,
    trustLevel: config.trust.level,
    permissionManager,
    extensionCommandNames,
    extensionCommands,
    extensionTools: integrations.tools,
    extensionProviders: integrations.providers,
    loadedSkills: integrations.skills,
    loadedMcpServers: integrations.mcpServers,
    extensionDirs,
    hookRegistry,
    systemPrompt,
  };

  return startREPL(context);
}

function mergeRuntimeInstructions(promptContent: string, baseInstructions: string, skills: RuntimeIntegrations["skills"]): string {
  const skillInstructions = composeSkillInstructions(skills);
  return [promptContent.trim(), baseInstructions.trim(), skillInstructions.trim()].filter(Boolean).join("\n\n");
}

function normalizeHeadlessFormat(format?: string): HeadlessFormat {
  if (format === "json" || format === "json-stream") {
    return format;
  }

  return "text";
}

function mapEngineStateToResultStatus(state: EngineState): "success" | "error" | "interrupted" | "max_turns" | "not_implemented" {
  if (state === "success") return "success";
  if (state === "interrupted") return "interrupted";
  if (state === "max_turns_reached") return "max_turns";
  if (state === "error") return "error";
  return "not_implemented";
}
function toHookContext(context: {
  sessionId?: string | null;
  turnCount?: number;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  toolSuccess?: boolean;
  error?: Error;
}): HookContext {
  return {
    sessionId: context.sessionId ?? undefined,
    turnCount: context.turnCount,
    toolName: context.toolName,
    toolCallId: context.toolCallId,
    toolInput: context.toolInput,
    toolSuccess: context.toolSuccess,
    error: context.error,
  };
}
