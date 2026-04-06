import type { CommandContext } from "../../commands/types.js";
import { QueryEngine, type AskUserQuestionRequest, type PermissionRequest } from "../../engine/QueryEngine.js";
import type { Message, StreamEvent } from "../../engine/types.js";
import type { McpServerConfig, Skill } from "../../extensions/contracts.js";
import type { HookRegistry } from "../hooks.js";
import type { HookContext } from "../hooks.js";
import type { TrustLevel } from "../permissions.js";
import { PermissionManager } from "../permissionManager.js";
import { getSettingsPath, loadSettingsForCwd, type Settings } from "../config.js";
import { resolveRuntimeProvider } from "../../providers/runtime.js";
import type { Provider } from "../../providers/types.js";
import { createMvpTools } from "../../tools/orchestration.js";
import {
  compactSessionIfNeeded,
  engineMessageToTranscriptMessage,
  ensureFreshSessionMemory,
  failPendingApprovalsForResume,
  transcriptToConversation,
} from "../../persistence/runtimeSessions.js";
import type { SessionStore } from "../../persistence/sessionStore.js";
import { buildApprovalKeyboard, parseApprovalCallbackData, TelegramApprovalCoordinator } from "./approvals.js";
import { normalizeTelegramCommandText } from "./commands.js";
import { TelegramDelivery } from "./delivery.js";
import type { TelegramLiveReply } from "./delivery.js";
import type { TelegramLogger } from "./logger.js";
import {
  bindTelegramSession,
  buildTelegramBindingKey,
  clearTelegramPendingApprovalToken,
  createTelegramSession,
  getOrCreateTelegramSession,
  listTelegramSessionsForBinding,
  setTelegramPendingApprovalToken,
  updateTelegramSessionMetadata,
} from "./sessions.js";
import { TelegramStateStore } from "./state.js";
import {
  TELEGRAM_BUSY_MESSAGE,
  type ResolvedTelegramRuntimeConfig,
  type TelegramBinding,
  type TelegramBot,
  type TelegramBotIdentity,
  type TelegramContext,
  type TelegramPendingQuestion,
  type TelegramPromptScope,
} from "./types.js";

interface TelegramRouterOptions {
  cwd: string;
  trustLevel: TrustLevel;
  bot: TelegramBot;
  botIdentity: TelegramBotIdentity;
  telegramConfig: ResolvedTelegramRuntimeConfig;
  sessionStore: SessionStore;
  state: TelegramStateStore;
  registry: {
    isCommand(input: string, context?: CommandContext): boolean;
    parseCommand(input: string): { name: string; args: string } | null;
    execute(name: string, args: string, context: CommandContext): Promise<{ success: boolean; output: string; data?: Record<string, unknown> }>;
  };
  permissionManager: PermissionManager;
  extensionCommandNames?: CommandContext["extensionCommandNames"];
  extensionCommands?: CommandContext["extensionCommands"];
  extensionTools?: CommandContext["extensionTools"];
  extensionProviders?: Provider[];
  loadedSkills?: Skill[];
  loadedMcpServers?: McpServerConfig[];
  extensionDirs?: string[];
  hookRegistry?: HookRegistry;
  systemPrompt?: string;
  logger?: TelegramLogger;
}

export class TelegramRouter {
  private readonly delivery: TelegramDelivery;
  private readonly approvals: TelegramApprovalCoordinator;
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly pendingQuestions = new Map<string, TelegramPendingQuestion>();
  private readonly startedSessions = new Set<string>();

  constructor(private readonly options: TelegramRouterOptions) {
    this.delivery = new TelegramDelivery(options.bot, options.telegramConfig);
    this.approvals = new TelegramApprovalCoordinator(options.state, options.permissionManager);
  }

  async handleMessage(ctx: TelegramContext): Promise<void> {
    const message = ctx.message;
    if (!message || !("text" in message) || typeof message.text !== "string") {
      return;
    }

    const rawText = message.text.trim();
    if (!rawText) {
      return;
    }

    const binding = this.resolveBinding(ctx);
    this.options.logger?.info("Telegram message received", {
      bindingKey: binding.bindingKey,
      chatId: binding.chatId,
      userId: binding.userId,
      chatType: binding.chatType,
      textLength: rawText.length,
      isCommand: rawText.startsWith("/"),
    });

    if (!this.isAllowed(binding)) {
      this.options.logger?.warn("Telegram message rejected by allowlist", {
        bindingKey: binding.bindingKey,
        chatId: binding.chatId,
        userId: binding.userId,
      });
      await this.delivery.sendText(this.toPromptScope(ctx, binding), "This Telegram user/chat is not allowed to control Pebble.");
      return;
    }

    const scope = this.toPromptScope(ctx, binding);
    const normalizedCommandText = normalizeTelegramCommandText(rawText, this.options.botIdentity.username);
    if (normalizedCommandText === null) {
      this.options.logger?.info("Telegram command ignored because it targeted another bot", {
        bindingKey: binding.bindingKey,
      });
      return;
    }

    const commandName = this.extractCommandName(normalizedCommandText);

    if (await this.handleApprovalTextCommand(scope, commandName, normalizedCommandText)) {
      return;
    }

    if (await this.handlePendingQuestion(scope, rawText, commandName)) {
      return;
    }

    if (commandName === "stop") {
      await this.handleStop(scope, binding);
      return;
    }

    if (this.activeRuns.has(binding.bindingKey)) {
      this.options.logger?.info("Telegram message ignored because a run is already active", {
        bindingKey: binding.bindingKey,
      });
      await this.delivery.sendText(scope, TELEGRAM_BUSY_MESSAGE);
      return;
    }

    if (!normalizedCommandText.startsWith("/") && this.shouldIgnoreAmbientGroupMessage(ctx, rawText)) {
      this.options.logger?.info("Telegram ambient group message ignored", {
        bindingKey: binding.bindingKey,
        chatId: binding.chatId,
      });
      return;
    }

    if (normalizedCommandText.startsWith("/")) {
      await this.handleCommand(scope, binding, normalizedCommandText);
      return;
    }

    const promptText = this.stripBotMention(rawText).trim();
    if (!promptText) {
      return;
    }

    await this.handlePrompt(scope, binding, promptText, typeof ctx.update.update_id === "number" ? ctx.update.update_id : undefined);
  }

  async handleCallbackQuery(ctx: TelegramContext): Promise<void> {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !("data" in callbackQuery) || typeof callbackQuery.data !== "string") {
      return;
    }

    const parsed = parseApprovalCallbackData(callbackQuery.data);
    if (!parsed) {
      return;
    }

    const result = this.approvals.resolveApproval(parsed.token, parsed.decision === "approve" ? "allow" : "deny");
    this.options.logger?.info("Telegram approval callback received", {
      token: parsed.token,
      decision: parsed.decision,
      resolved: Boolean(result.record),
      resumedLiveFlow: result.resumedLiveFlow,
    });
    await ctx.answerCallbackQuery({
      text: result.record
        ? `${parsed.decision === "approve" ? "Approved" : "Denied"} ${result.record.toolName}`
        : "This approval is no longer active.",
    });

    const message = callbackQuery.message;
    if (message && "message_id" in message) {
      try {
        await this.delivery.updateReplyMarkup({
          chatId: message.chat.id,
          threadId: "message_thread_id" in message && typeof message.message_thread_id === "number"
            ? message.message_thread_id
            : undefined,
          binding: {
            bindingKey: buildTelegramBindingKey(
              message.chat.id,
              "message_thread_id" in message ? message.message_thread_id : undefined,
            ),
            chatId: String(message.chat.id),
            threadId: "message_thread_id" in message && typeof message.message_thread_id === "number"
              ? String(message.message_thread_id)
              : undefined,
            chatType: message.chat.type,
          },
        }, message.message_id);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  private async handleCommand(scope: TelegramPromptScope, binding: TelegramBinding, text: string): Promise<void> {
    const parsed = this.options.registry.parseCommand(text);
    if (!parsed) {
      await this.delivery.sendText(scope, "Unknown Telegram command.");
      return;
    }

    switch (parsed.name) {
      case "start": {
        this.options.logger?.info("Telegram native command executed", {
          bindingKey: binding.bindingKey,
          command: parsed.name,
        });
        await this.delivery.sendText(scope, this.buildStatusMessage(binding));
        return;
      }
      case "new": {
        this.options.logger?.info("Telegram native command executed", {
          bindingKey: binding.bindingKey,
          command: parsed.name,
        });
        const session = createTelegramSession(this.options.sessionStore, this.options.state, binding);
        await this.delivery.sendText(scope, `Started a new Pebble session for this chat:\n${session.id}`);
        return;
      }
      case "sessions": {
        this.options.logger?.info("Telegram native command executed", {
          bindingKey: binding.bindingKey,
          command: parsed.name,
        });
        const summaries = listTelegramSessionsForBinding(this.options.sessionStore, this.options.state, binding.bindingKey);
        if (summaries.length === 0) {
          await this.delivery.sendText(scope, "No prior Pebble sessions are bound to this chat/topic yet.");
          return;
        }

        await this.delivery.sendText(
          scope,
          [
            "Recent sessions for this chat/topic:",
            ...summaries.slice(0, 8).map((summary) => `${summary.isActive ? "*" : "-"} ${summary.id} — ${summary.title}`),
          ].join("\n"),
        );
        return;
      }
      case "resume": {
        this.options.logger?.info("Telegram native command executed", {
          bindingKey: binding.bindingKey,
          command: parsed.name,
        });
        const sessionId = parsed.args.trim();
        if (!sessionId) {
          await this.delivery.sendText(scope, "Usage: /resume <session-id>");
          return;
        }

        const summaries = listTelegramSessionsForBinding(this.options.sessionStore, this.options.state, binding.bindingKey);
        if (!summaries.some((summary) => summary.id === sessionId)) {
          await this.delivery.sendText(scope, `Session ${sessionId} is not bound to this chat/topic. Use /sessions first.`);
          return;
        }

        const transcript = bindTelegramSession(this.options.sessionStore, this.options.state, binding, sessionId);
        await this.delivery.sendText(scope, transcript
          ? `Resumed ${transcript.id} for this chat/topic.`
          : `Could not find session ${sessionId}.`);
        return;
      }
      case "status": {
        this.options.logger?.info("Telegram native command executed", {
          bindingKey: binding.bindingKey,
          command: parsed.name,
        });
        await this.delivery.sendText(scope, this.buildStatusMessage(binding));
        return;
      }
      default:
        break;
    }

    const settings = loadSettingsForCwd(this.options.cwd);
    const activeSessionId = this.options.state.getBinding(binding.bindingKey)?.sessionId ?? null;
    const commandContext: CommandContext = {
      cwd: this.options.cwd,
      mode: "telegram",
      headless: false,
      config: this.buildCommandConfig(settings),
      sessionStore: this.options.sessionStore,
      sessionId: activeSessionId,
      trustLevel: this.options.trustLevel,
      permissionManager: this.options.permissionManager,
      extensionCommandNames: this.options.extensionCommandNames,
      extensionCommands: this.options.extensionCommands,
      extensionTools: this.options.extensionTools,
      extensionProviders: this.options.extensionProviders,
      loadedSkills: this.options.loadedSkills,
      loadedMcpServers: this.options.loadedMcpServers,
      extensionDirs: this.options.extensionDirs,
      hookRegistry: this.options.hookRegistry,
      systemPrompt: this.options.systemPrompt,
    };

    if (!this.options.registry.isCommand(text, commandContext)) {
      this.options.logger?.warn("Telegram command unavailable", {
        bindingKey: binding.bindingKey,
        command: parsed.name,
      });
      await this.delivery.sendText(scope, `Unknown or unavailable command: /${parsed.name}`);
      return;
    }

    this.options.logger?.info("Telegram shared command executing", {
      bindingKey: binding.bindingKey,
      command: parsed.name,
    });
    const result = await this.options.registry.execute(parsed.name, parsed.args, commandContext);

    if (result.data?.action === "open-settings") {
      await this.delivery.sendText(scope, "That command opens Pebble's interactive settings UI, so it is only available in the TUI.");
      return;
    }

    if (result.data?.action === "config-updated") {
      await this.delivery.sendText(scope, result.output || "Settings updated.");
      return;
    }

    await this.delivery.sendText(scope, result.output || `Command /${parsed.name} completed.`);
    this.options.logger?.info("Telegram shared command completed", {
      bindingKey: binding.bindingKey,
      command: parsed.name,
      success: result.success,
      action: typeof result.data?.action === "string" ? result.data.action : undefined,
    });
  }

  private async handlePrompt(
    scope: TelegramPromptScope,
    binding: TelegramBinding,
    promptText: string,
    updateId?: number,
  ): Promise<void> {
    const settings = loadSettingsForCwd(this.options.cwd);
    const resolvedProvider = resolveRuntimeProvider(settings, {}, this.options.extensionProviders ?? []);
    const session = getOrCreateTelegramSession(this.options.sessionStore, this.options.state, binding, updateId);
    const controller = new AbortController();
    const liveReply = this.delivery.createLiveReply(scope);

    this.activeRuns.set(binding.bindingKey, controller);
    this.options.logger?.info("Telegram prompt starting", {
      bindingKey: binding.bindingKey,
      sessionId: session.id,
      providerId: resolvedProvider.providerId,
      model: resolvedProvider.model,
      promptLength: promptText.length,
      updateId,
    });

    try {
      failPendingApprovalsForResume(this.options.sessionStore, this.options.permissionManager, session.id);
      if (!this.startedSessions.has(session.id)) {
        await this.options.hookRegistry?.fire("session:start", { sessionId: session.id });
        this.startedSessions.add(session.id);
      }
      await this.options.hookRegistry?.fire("turn:before", { sessionId: session.id });

      await liveReply.start();

      this.options.sessionStore.appendMessage(session.id, {
        role: "user",
        content: promptText,
        timestamp: new Date().toISOString(),
      });
      compactSessionIfNeeded(this.options.sessionStore, session.id, this.buildCompactionPolicy(settings, resolvedProvider));

      const transcript = ensureFreshSessionMemory(this.options.sessionStore, session.id)
        ?? this.options.sessionStore.loadTranscript(session.id)
        ?? session;
      const conversation = transcriptToConversation(transcript, this.buildCompactionPolicy(settings, resolvedProvider));
      const engine = new QueryEngine({
        provider: resolvedProvider.provider,
        tools: createMvpTools(this.options.extensionTools ?? []),
        maxTurns: settings.maxTurns ?? 50,
        systemPrompt: this.options.systemPrompt,
        signal: controller.signal,
        permissionManager: this.options.permissionManager,
        cwd: this.options.cwd,
        shellCompactionMode: settings.shellCompactionMode,
        sessionStore: this.options.sessionStore,
        getSessionId: () => session.id,
        extensionDirs: this.options.extensionDirs,
        skills: this.options.loadedSkills,
        mcpServers: this.options.loadedMcpServers,
        onLifecycleEvent: (event, context) => this.options.hookRegistry?.fire(event, toHookContext(context)),
        resolvePermission: (request) => this.resolvePermission(scope, binding, session.id, request),
        resolveQuestion: (request) => this.resolveQuestion(scope, binding, request),
      });

      const iterator = engine.stream(conversation)[Symbol.asyncIterator]();
      let result: Awaited<ReturnType<QueryEngine["process"]>> | null = null;

      while (true) {
        const step = await iterator.next();
        if (step.done) {
          result = step.value;
          break;
        }

        await this.applyStreamEvent(liveReply, step.value);
      }

      if (!result) {
        throw new Error("Telegram query completed without a terminal result.");
      }

      const newMessages = result.messages.slice(conversation.length);
      for (const message of newMessages) {
        const transcriptMessage = engineMessageToTranscriptMessage(message);
        if (transcriptMessage) {
          this.options.sessionStore.appendMessage(session.id, transcriptMessage);
        }
      }

      compactSessionIfNeeded(this.options.sessionStore, session.id, this.buildCompactionPolicy(settings, resolvedProvider));
      const finalMessageId = await liveReply.finalize();
      updateTelegramSessionMetadata(this.options.sessionStore, session.id, binding, {
        ...(typeof updateId === "number" ? { lastInboundUpdateId: updateId } : {}),
        ...(typeof finalMessageId === "number" ? { lastOutboundMessageId: finalMessageId } : {}),
      });
      clearTelegramPendingApprovalToken(this.options.sessionStore, session.id, binding);
      this.options.sessionStore.updateStatus(
        session.id,
        result.success ? "completed" : result.state === "interrupted" ? "interrupted" : "error",
      );
      this.options.logger?.info("Telegram prompt finished", {
        bindingKey: binding.bindingKey,
        sessionId: session.id,
        success: result.success,
        state: result.state,
        finalMessageId,
      });
      await this.options.hookRegistry?.fire("turn:after", { sessionId: session.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.sessionStore.updateStatus(session.id, controller.signal.aborted ? "interrupted" : "error");
      this.options.logger?.error("Telegram prompt failed", {
        bindingKey: binding.bindingKey,
        sessionId: session.id,
        aborted: controller.signal.aborted,
        error: message,
      });
      await liveReply.fail(controller.signal.aborted
        ? "The active Telegram run was stopped."
        : `Error: ${message}`);
      await this.options.hookRegistry?.fire("error", {
        sessionId: session.id,
        error: error instanceof Error ? error : new Error(message),
      });
    } finally {
      this.activeRuns.delete(binding.bindingKey);
    }
  }

  private async handleStop(scope: TelegramPromptScope, binding: TelegramBinding): Promise<void> {
    const activeRun = this.activeRuns.get(binding.bindingKey);
    if (!activeRun || activeRun.signal.aborted) {
      this.options.logger?.info("Telegram stop requested with no active run", {
        bindingKey: binding.bindingKey,
      });
      await this.delivery.sendText(scope, "No active Pebble run is in flight for this chat/topic.");
      return;
    }

    activeRun.abort();
    this.options.logger?.info("Telegram run stop requested", {
      bindingKey: binding.bindingKey,
    });
    await this.delivery.sendText(scope, "Stopping the active Pebble run for this chat/topic…");
  }

  private async handleApprovalTextCommand(
    scope: TelegramPromptScope,
    commandName: string | null,
    text: string,
  ): Promise<boolean> {
    if (commandName !== "approve" && commandName !== "deny") {
      return false;
    }

    const parsed = this.options.registry.parseCommand(text);
    const token = parsed?.args.trim();
    if (!token) {
      await this.delivery.sendText(scope, `Usage: /${commandName} <approval-id>`);
      return true;
    }

    const result = this.approvals.resolveApproval(token, commandName === "approve" ? "allow" : "deny");
    this.options.logger?.info("Telegram approval text command received", {
      token,
      command: commandName,
      resolved: Boolean(result.record),
      resumedLiveFlow: result.resumedLiveFlow,
    });
    await this.delivery.sendText(
      scope,
      result.record
        ? `${commandName === "approve" ? "Approved" : "Denied"} ${result.record.toolName}${result.resumedLiveFlow ? ". Pebble is resuming the waiting run." : ", but the original run is no longer active."}`
        : "That approval token is unknown or already resolved.",
    );
    return true;
  }

  private async handlePendingQuestion(
    scope: TelegramPromptScope,
    text: string,
    commandName: string | null,
  ): Promise<boolean> {
    const pendingQuestion = this.pendingQuestions.get(scope.binding.bindingKey);
    if (!pendingQuestion) {
      return false;
    }

    if (commandName && commandName !== "stop") {
      this.options.logger?.info("Telegram question awaiting answer blocked a command", {
        bindingKey: scope.binding.bindingKey,
        command: commandName,
      });
      await this.delivery.sendText(scope, "Pebble is waiting for an answer to the previous question. Reply with your answer or use /stop.");
      return true;
    }

    const answer = text.trim();
    if (!answer) {
      return true;
    }

    if (!pendingQuestion.allowFreeform && !pendingQuestion.options.includes(answer)) {
      await this.delivery.sendText(
        scope,
        `Please answer with one of: ${pendingQuestion.options.join(", ")}`,
      );
      return true;
    }

    this.pendingQuestions.delete(scope.binding.bindingKey);
    pendingQuestion.resolve(answer);
    this.options.logger?.info("Telegram follow-up question answered", {
      bindingKey: scope.binding.bindingKey,
      answerLength: answer.length,
    });
    await this.delivery.sendText(scope, `Answer received: ${answer}`);
    return true;
  }

  private async resolvePermission(
    scope: TelegramPromptScope,
    binding: TelegramBinding,
    sessionId: string,
    request: PermissionRequest,
  ) {
    const approval = await this.approvals.requestApproval({
      sessionId,
      binding,
      toolName: request.toolName,
      toolArgs: request.toolArgs,
      approvalMessage: request.approvalMessage,
    });

    setTelegramPendingApprovalToken(this.options.sessionStore, sessionId, binding, approval.token);
    this.options.logger?.info("Telegram approval requested", {
      bindingKey: binding.bindingKey,
      sessionId,
      toolName: request.toolName,
      token: approval.token,
    });
    await this.delivery.sendText(
      scope,
      `${request.approvalMessage}\nApproval ID: ${approval.token}`,
      { replyMarkup: buildApprovalKeyboard(approval.token) },
    );
    clearTelegramPendingApprovalToken(this.options.sessionStore, sessionId, binding);
    return approval.decision;
  }

  private async resolveQuestion(
    scope: TelegramPromptScope,
    binding: TelegramBinding,
    request: AskUserQuestionRequest,
  ): Promise<string> {
    await this.delivery.sendText(
      scope,
      [
        request.question,
        request.options.length > 0 ? `Options: ${request.options.join(", ")}` : undefined,
      ].filter(Boolean).join("\n"),
      { forceReply: true },
    );

    return await new Promise<string>((resolve) => {
      this.pendingQuestions.set(binding.bindingKey, {
        bindingKey: binding.bindingKey,
        question: request.question,
        options: request.options,
        allowFreeform: request.allowFreeform,
        resolve,
      });
    });
  }

  private async applyStreamEvent(liveReply: TelegramLiveReply, event: StreamEvent): Promise<void> {
    const data = event.data as Record<string, unknown> | undefined;
    switch (event.type) {
      case "text_delta": {
        const delta = typeof data?.text === "string"
          ? data.text
          : typeof data?.delta === "string"
            ? data.delta
            : "";
        if (delta) {
          await liveReply.append(delta);
        }
        return;
      }
      case "tool_call": {
        const tool = typeof data?.tool === "string" ? data.tool : "tool";
        await liveReply.note(`Running tool: ${tool}`);
        return;
      }
      case "tool_result": {
        const tool = typeof data?.tool === "string" ? data.tool : "tool";
        const success = data?.success !== false;
        const summary = typeof data?.summary === "string"
          ? data.summary
          : typeof data?.error === "string"
            ? data.error
            : undefined;
        if (!success || summary) {
          await liveReply.note(`${success ? "Tool finished" : "Tool failed"}: ${tool}${summary ? ` — ${summary}` : ""}`);
        }
        return;
      }
      case "permission_denied": {
        const reason = typeof data?.reason === "string" ? data.reason : "Permission denied";
        await liveReply.note(`Permission denied: ${reason}`);
        return;
      }
      case "error": {
        const message = typeof data?.message === "string" ? data.message : "Unknown error";
        await liveReply.note(`Error: ${message}`);
        return;
      }
      default:
        return;
    }
  }

  private buildStatusMessage(binding: TelegramBinding): string {
    const activeSessionId = this.options.state.getBinding(binding.bindingKey)?.sessionId ?? "(none)";
    const pendingApprovals = this.approvals.listPending(binding.bindingKey);
    const lastUpdateId = this.options.state.getLastUpdateId();
    const settings = loadSettingsForCwd(this.options.cwd);
    const provider = resolveRuntimeProvider(settings, {}, this.options.extensionProviders ?? []);

    return [
      "Pebble Telegram runtime",
      `Binding: ${binding.bindingKey}`,
      `Chat: ${binding.chatId}${binding.threadId ? ` / thread ${binding.threadId}` : ""}`,
      `Active session: ${activeSessionId}`,
      `Provider: ${provider.providerLabel} (${provider.providerId})`,
      `Model: ${provider.model}`,
      `Last update id: ${typeof lastUpdateId === "number" ? lastUpdateId : "(none yet)"}`,
      `Pending approvals: ${pendingApprovals.length}`,
      `Pending question: ${this.pendingQuestions.has(binding.bindingKey) ? "yes" : "no"}`,
      `Run active: ${this.activeRuns.has(binding.bindingKey) ? "yes" : "no"}`,
    ].join("\n");
  }

  private buildCommandConfig(settings: Settings): Record<string, unknown> {
    const resolved = resolveRuntimeProvider(settings, {}, this.options.extensionProviders ?? []);
    return {
      permissionMode: settings.permissionMode,
      provider: resolved.providerId,
      providerLabel: resolved.providerLabel,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      apiKeyConfigured: resolved.apiKeyConfigured,
      apiKeySource: resolved.apiKeySource,
      compactThreshold: settings.compactThreshold,
      compactPrepareThreshold: settings.compactPrepareThreshold,
      compactionInstructions: settings.compactionInstructions,
      shellCompactionMode: settings.shellCompactionMode,
      providerCompactionMarkers: settings.providerCompactionMarkers,
      worktreeStartupMode: settings.worktreeStartupMode,
      telegram: settings.telegram,
      settingsPath: getSettingsPath(this.options.cwd),
    };
  }

  private buildCompactionPolicy(settings: Settings, resolvedProvider: ReturnType<typeof resolveRuntimeProvider>) {
    return {
      compactThreshold: settings.compactThreshold,
      compactPrepareThreshold: settings.compactPrepareThreshold,
      instructions: settings.compactionInstructions,
      providerContext: {
        markersEnabled: settings.providerCompactionMarkers,
        providerId: resolvedProvider.providerId,
        model: resolvedProvider.model,
      },
    };
  }

  private resolveBinding(ctx: TelegramContext): TelegramBinding {
    const message = ctx.message;
    const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
    const source = message ?? callbackMessage;
    const threadId = source && "message_thread_id" in source && typeof source.message_thread_id === "number"
      ? String(source.message_thread_id)
      : undefined;
    const chatId = String(source?.chat.id ?? ctx.chat?.id ?? "0");
    return {
      bindingKey: buildTelegramBindingKey(chatId, threadId),
      chatId,
      userId: typeof ctx.from?.id === "number" ? String(ctx.from.id) : undefined,
      threadId,
      chatType: source?.chat.type ?? "unknown",
    };
  }

  private toPromptScope(ctx: TelegramContext, binding: TelegramBinding): TelegramPromptScope {
    const message = ctx.message;
    const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
    const source = message ?? callbackMessage;
    const threadId = source && "message_thread_id" in source && typeof source.message_thread_id === "number"
      ? source.message_thread_id
      : undefined;

    return {
      chatId: source?.chat.id ?? ctx.chat?.id ?? 0,
      threadId,
      binding,
    };
  }

  private isAllowed(binding: TelegramBinding): boolean {
    const allowedUsers = this.options.telegramConfig.allowedUserIds;
    const allowedChats = this.options.telegramConfig.allowedChatIds;
    const userAllowed = allowedUsers.length === 0 || (binding.userId ? allowedUsers.includes(binding.userId) : false);
    const chatAllowed = allowedChats.length === 0 || allowedChats.includes(binding.chatId);
    return userAllowed || chatAllowed;
  }

  private shouldIgnoreAmbientGroupMessage(ctx: TelegramContext, text: string): boolean {
    const message = ctx.message;
    if (!message) {
      return false;
    }

    const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
    if (!isGroup) {
      return false;
    }

    if (!this.options.telegramConfig.handleGroupMentionsOnly) {
      return false;
    }

    const repliedToBot = message.reply_to_message?.from?.id !== undefined
      && String(message.reply_to_message.from.id) === this.options.botIdentity.id;
    if (repliedToBot) {
      return false;
    }

    const username = this.options.botIdentity.username;
    return !username || !text.toLowerCase().includes(`@${username.toLowerCase()}`);
  }

  private stripBotMention(text: string): string {
    const username = this.options.botIdentity.username;
    if (!username) {
      return text;
    }

    return text.replace(new RegExp(`@${username}`, "giu"), "").trim();
  }

  private extractCommandName(text: string): string | null {
    if (!text.startsWith("/")) {
      return null;
    }

    const parsed = this.options.registry.parseCommand(text);
    return parsed?.name ?? null;
  }
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
