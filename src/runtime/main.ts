/**
 * Runtime main entry point.
 *
 * This is the full runtime boot — called after fast-path checks pass.
 * It initializes config, trust, providers, extensions, and starts
 * either the interactive REPL or headless mode.
 */

import { BUILD_INFO, getVersionString } from "../build/buildInfo.js";
import { getFeatureSummary, isFeatureEnabled } from "../build/featureFlags.js";
import { buildRuntimeConfig } from "./config.js";
import { PermissionManager } from "./permissionManager.js";
import { loadRepositoryInstructions, formatInstructions } from "./instructions.js";
import { createProjectSessionStore, createOrResumeSession, transcriptToConversation, engineMessageToTranscriptMessage } from "../persistence/runtimeSessions.js";
import { getSettingsPath } from "./config.js";
import { resolveProviderConfig } from "../providers/config.js";

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
  /** Abort signal */
  signal?: AbortSignal;
}

export async function run(options: RuntimeOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  // Phase 1: Log startup
  console.error(getVersionString());
  console.error(getFeatureSummary());
  console.error(`Mode: ${options.headless ? "headless" : "interactive"}`);
  console.error(`Working directory: ${cwd}`);

  // Phase 2: Initialize config layer
  const config = buildRuntimeConfig(cwd);
  const resolvedProvider = resolveProviderConfig(config.settings, {
    provider: options.provider,
    model: options.model,
  });
  console.error(`Trust level: ${config.trust.level}`);
  console.error(`Project root: ${config.trust.projectRoot}`);
  console.error(`Provider: ${resolvedProvider.providerLabel} (${resolvedProvider.model})`);

  // Phase 3: Initialize trust system
  const permissionManager = new PermissionManager({
    mode: config.settings.permissionMode,
    projectRoot: config.trust.projectRoot,
  });

  // Phase 4: Load repository instructions
  const instructions = formatInstructions(config.instructions);
  if (instructions) {
    console.error(`Loaded ${config.instructions.length} instruction file(s)`);
  }

  // Phase 5: Initialize extensions (stub)
  // TODO: Load MCP servers, plugins, skills

  // Phase 6: Start the appropriate mode
  if (options.headless) {
    return runHeadless(options, config, permissionManager, instructions);
  }

  return runInteractive(options, config, permissionManager, instructions);
}

async function runHeadless(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  instructions: string,
): Promise<number> {
  if (!options.prompt) {
    console.error("Error: headless mode requires --prompt");
    return 1;
  }

  console.error("Headless mode: processing prompt...");
  console.error(`Permission mode: ${config.settings.permissionMode}`);
  console.error(`Instructions: ${instructions ? "loaded" : "none"}`);

  // Initialize engine for headless execution
  const { createPrimaryProvider } = await import("../providers/primary/index.js");
  const { createMvpTools } = await import("../tools/orchestration.js");
  const { query } = await import("../engine/query.js");

  const provider = createPrimaryProvider({
    settings: config.settings,
    provider: options.provider,
    model: options.model,
  });
  const tools = createMvpTools();
  const sessionStore = createProjectSessionStore(config.cwd);
  const session = createOrResumeSession(sessionStore, options.resume);

  const systemPrompt = instructions || undefined;

  try {
    if (options.prompt) {
      sessionStore.appendMessage(session.id, {
        role: "user",
        content: options.prompt,
        timestamp: new Date().toISOString(),
      });
    }

    const inputTranscript = sessionStore.loadTranscript(session.id) ?? session;
    const conversation = transcriptToConversation(inputTranscript, config.settings.compactThreshold);

    const result = await query(
      conversation,
      {
        provider,
        tools,
        maxTurns: config.settings.maxTurns ?? 50,
        systemPrompt,
        signal: options.signal,
        permissionManager,
        cwd: config.cwd,
      },
    );

    const newMessages = result.messages.slice(conversation.length);
    for (const message of newMessages) {
      const transcriptMessage = engineMessageToTranscriptMessage(message);
      if (transcriptMessage) {
        sessionStore.appendMessage(session.id, transcriptMessage);
      }
    }

    sessionStore.updateStatus(session.id, result.success ? "completed" : result.state === "interrupted" ? "interrupted" : "error");

    // Output structured result for headless callers
    const output = {
      type: "result",
      status: result.state,
      success: result.success,
      message: result.success ? "Query completed successfully" : result.error,
      sessionId: session.id,
      usage: result.usage,
      messages: result.messages,
    };

    console.log(JSON.stringify(output, null, 2));
    return result.success ? 0 : 1;
  } catch (error) {
    sessionStore.updateStatus(session.id, "error");
    const errorOutput = {
      type: "result",
      status: "error",
      success: false,
      message: error instanceof Error ? error.message : String(error),
      sessionId: session.id,
    };
    console.error(JSON.stringify(errorOutput, null, 2));
    return 1;
  }
}

async function runInteractive(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  instructions: string,
): Promise<number> {
  const resolvedProvider = resolveProviderConfig(config.settings, {
    provider: options.provider,
    model: options.model,
  });

  console.error("Interactive mode: starting REPL...");
  console.error(`Trust level: ${config.trust.level}`);
  console.error(`Permission mode: ${config.settings.permissionMode}`);
  console.error(`Instructions: ${instructions ? "loaded" : "none"}`);

  // Import Ink REPL dynamically to avoid blocking fast paths
  const { startREPL } = await import("../ui/App.js");

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
    },
    sessionStore: createProjectSessionStore(config.cwd),
    sessionId: options.resume ?? null,
    trustLevel: config.trust.level,
    permissionManager,
    extensionCommandNames: [],
  };

  return startREPL(context);
}
