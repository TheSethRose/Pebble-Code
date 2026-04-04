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
import { createProjectSessionStore, createOrResumeSession, compactSessionIfNeeded, transcriptToConversation, engineMessageToTranscriptMessage } from "../persistence/runtimeSessions.js";
import { getSettingsPath } from "./config.js";
import { resolveProviderConfig } from "../providers/config.js";
import { getDefaultExtensionDirs, loadExtensions, reportExtensionStatus } from "../extensions/loaders.js";
import type { Command } from "../commands/types.js";
import type { Message, StreamEvent, EngineState } from "../engine/types.js";
import {
  createInitEvent,
  createPermissionDenialEvent,
  createResultEnvelope,
  createStreamEvent,
  createUserReplayEvent,
  serializeSdkEvent,
} from "../engine/sdkProtocol.js";

export type HeadlessFormat = "text" | "json" | "json-stream";

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

  // Phase 5: Initialize extensions
  const extensionResults = await loadExtensions(getDefaultExtensionDirs(cwd));
  reportExtensionStatus(extensionResults);
  const extensionCommands = extensionResults
    .filter((result) => result.loaded && result.extension?.commands?.length)
    .flatMap((result) => result.extension?.commands ?? []);
  const extensionCommandNames = extensionCommands.map((command) => command.name);

  // Phase 6: Start the appropriate mode
  if (options.headless) {
    return runHeadless(options, config, permissionManager, instructions, extensionCommandNames);
  }

  return runInteractive(options, config, permissionManager, instructions, extensionCommands, extensionCommandNames);
}

async function runHeadless(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  instructions: string,
  extensionCommandNames: string[],
): Promise<number> {
  if (!options.prompt) {
    console.error("Error: headless mode requires --prompt");
    return 1;
  }

  const format = normalizeHeadlessFormat(options.format);

  console.error("Headless mode: processing prompt...");
  console.error(`Permission mode: ${config.settings.permissionMode}`);
  console.error(`Output format: ${format}`);
  console.error(`Instructions: ${instructions ? "loaded" : "none"}`);
  if (extensionCommandNames.length > 0) {
    console.error(`Extension commands available: ${extensionCommandNames.join(", ")}`);
  }

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
  const emitSdkEvent = (
    event:
      | ReturnType<typeof createInitEvent>
      | ReturnType<typeof createUserReplayEvent>
      | ReturnType<typeof createStreamEvent>
      | ReturnType<typeof createPermissionDenialEvent>
      | ReturnType<typeof createResultEnvelope>,
  ) => {
    if (format === "json-stream") {
      console.log(serializeSdkEvent(event));
    }
  };

  try {
    if (options.prompt) {
      sessionStore.appendMessage(session.id, {
        role: "user",
        content: options.prompt,
        timestamp: new Date().toISOString(),
      });
    }

    const inputTranscript = compactSessionIfNeeded(
      sessionStore,
      session.id,
      config.settings.compactThreshold,
    ) ?? sessionStore.loadTranscript(session.id) ?? session;
    const conversation = transcriptToConversation(inputTranscript, config.settings.compactThreshold);

    emitSdkEvent(createInitEvent(session.id, provider.model, provider.name, config.cwd));
    emitSdkEvent(createUserReplayEvent(options.prompt));

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
        onEvent: (event: StreamEvent) => emitHeadlessStreamEvent(event, emitSdkEvent),
      },
    );

    const newMessages = result.messages.slice(conversation.length);
    for (const message of newMessages) {
      const transcriptMessage = engineMessageToTranscriptMessage(message);
      if (transcriptMessage) {
        sessionStore.appendMessage(session.id, transcriptMessage);
      }
    }

    const compactedTranscript = compactSessionIfNeeded(
      sessionStore,
      session.id,
      config.settings.compactThreshold,
    );

    sessionStore.updateStatus(session.id, result.success ? "completed" : result.state === "interrupted" ? "interrupted" : "error");

    if (format === "json-stream") {
      emitAssistantReplayEvents(newMessages, emitSdkEvent);
      emitSdkEvent(
        createResultEnvelope(
          mapEngineStateToResultStatus(result.state),
          result.success ? "Query completed successfully" : result.error ?? "Query failed",
          session.id,
          {
            success: result.success,
            usage: result.usage,
            messageCount: compactedTranscript?.messages.length ?? result.messages.length,
          },
        ),
      );
    } else if (format === "json") {
      console.log(JSON.stringify(createResultEnvelope(
        mapEngineStateToResultStatus(result.state),
        result.success ? "Query completed successfully" : result.error ?? "Query failed",
        session.id,
        {
          success: result.success,
          usage: result.usage,
          messages: result.messages,
        },
      )));
    } else {
      printHeadlessTextOutput(newMessages, result.error);
    }

    return result.success ? 0 : 1;
  } catch (error) {
    sessionStore.updateStatus(session.id, "error");

    const message = error instanceof Error ? error.message : String(error);
    if (format === "json-stream") {
      emitSdkEvent(createResultEnvelope("error", message, session.id));
    } else if (format === "json") {
      console.log(JSON.stringify(createResultEnvelope("error", message, session.id)));
    } else {
      console.error(message);
    }

    return 1;
  }
}

async function runInteractive(
  options: RuntimeOptions,
  config: ReturnType<typeof buildRuntimeConfig>,
  permissionManager: PermissionManager,
  instructions: string,
  extensionCommands: Command[],
  extensionCommandNames: string[],
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
    extensionCommandNames,
    extensionCommands,
  };

  return startREPL(context);
}

function normalizeHeadlessFormat(format?: string): HeadlessFormat {
  if (format === "json" || format === "json-stream") {
    return format;
  }

  return "text";
}

function emitHeadlessStreamEvent(
  event: StreamEvent,
  emitSdkEvent: (
    event:
      | ReturnType<typeof createInitEvent>
      | ReturnType<typeof createUserReplayEvent>
      | ReturnType<typeof createStreamEvent>
      | ReturnType<typeof createPermissionDenialEvent>
      | ReturnType<typeof createResultEnvelope>,
  ) => void,
): void {
  if (event.type === "permission_denied") {
    const data = (event.data ?? {}) as { tool?: string; reason?: string };
    emitSdkEvent(createPermissionDenialEvent(data.tool ?? "unknown", data.reason ?? "Permission denied"));
    return;
  }

  emitSdkEvent(createStreamEvent(event.type, event.data));
}

function emitAssistantReplayEvents(
  messages: Message[],
  emitSdkEvent: (
    event:
      | ReturnType<typeof createInitEvent>
      | ReturnType<typeof createUserReplayEvent>
      | ReturnType<typeof createStreamEvent>
      | ReturnType<typeof createPermissionDenialEvent>
      | ReturnType<typeof createResultEnvelope>,
  ) => void,
): void {
  for (const message of messages) {
    if (message.role === "assistant" && message.content.trim().length > 0) {
      emitSdkEvent(createStreamEvent("text_delta", { delta: message.content }));
    }
  }
}

function mapEngineStateToResultStatus(state: EngineState): "success" | "error" | "interrupted" | "max_turns" | "not_implemented" {
  if (state === "success") return "success";
  if (state === "interrupted") return "interrupted";
  if (state === "max_turns_reached") return "max_turns";
  if (state === "error") return "error";
  return "not_implemented";
}

function printHeadlessTextOutput(messages: Message[], error?: string): void {
  const assistantText = messages
    .filter((message) => message.role === "assistant" && message.content.trim().length > 0)
    .map((message) => message.content.trim())
    .join("\n\n")
    .trim();

  if (assistantText.length > 0) {
    console.log(assistantText);
    return;
  }

  if (error) {
    console.log(error);
  }
}
