/**
 * Query engine — the heart of Pebble Code.
 *
 * Processes multi-turn conversations with tool-use cycles,
 * streaming responses, and bounded recursion.
 */

import type { Provider, StreamChunk, ProviderResponse } from "../providers/types.js";
import type { McpServerConfig, Skill } from "../extensions/contracts.js";
import type { SessionStore } from "../persistence/sessionStore.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolApprovalRequest, ToolContext } from "../tools/Tool.js";
import type { Message, StreamEvent, EngineState } from "./types.js";
import { emitStreamEvent } from "./transitions.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PermissionManager } from "../runtime/permissionManager.js";
import type { PermissionDecision } from "../runtime/permissions.js";

export function normalizeProviderToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : undefined;
  const unionBranches = anyOf ?? oneOf ?? allOf;
  const schemaType = typeof schema.type === "string" ? schema.type : undefined;

  if (!unionBranches || unionBranches.length === 0) {
    return schema;
  }

  const allBranchesAreObjects = unionBranches.every((branch) => {
    if (!branch || typeof branch !== "object") {
      return false;
    }

    return (branch as Record<string, unknown>).type === "object";
  });

  if (!allBranchesAreObjects) {
    return schema;
  }

  const mergedProperties = new Map<string, Record<string, unknown>>();
  const branchRequiredSets = unionBranches.map((branch) => {
    const record = branch as Record<string, unknown>;
    return new Set(Array.isArray(record.required) ? record.required.filter((value): value is string => typeof value === "string") : []);
  });
  const sharedRequired = new Set<string>(branchRequiredSets[0] ? [...branchRequiredSets[0]] : []);

  for (const requiredSet of branchRequiredSets.slice(1)) {
    for (const key of [...sharedRequired]) {
      if (!requiredSet.has(key)) {
        sharedRequired.delete(key);
      }
    }
  }

  for (const branch of unionBranches) {
    const record = branch as Record<string, unknown>;
    const properties = record.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      continue;
    }

    for (const [propertyName, propertySchemaValue] of Object.entries(properties)) {
      if (!propertySchemaValue || typeof propertySchemaValue !== "object" || Array.isArray(propertySchemaValue)) {
        continue;
      }

      const propertySchema = propertySchemaValue as Record<string, unknown>;
      const existing = mergedProperties.get(propertyName);
      if (!existing) {
        mergedProperties.set(propertyName, propertySchema);
        continue;
      }

      const merged = mergeProviderSchemaProperty(propertyName, existing, propertySchema);
      mergedProperties.set(propertyName, merged);
    }
  }

  const { anyOf: _ignoredAnyOf, oneOf: _ignoredOneOf, allOf: _ignoredAllOf, ...rest } = schema;

  return {
    ...rest,
    type: schemaType ?? "object",
    properties: Object.fromEntries(mergedProperties.entries()),
    required: [...sharedRequired],
    additionalProperties: unionBranches.every((branch) => {
      const additionalProperties = (branch as Record<string, unknown>).additionalProperties;
      return additionalProperties === false;
    }) ? false : rest.additionalProperties,
  };
}

function mergeProviderSchemaProperty(
  propertyName: string,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const variants = dedupeSchemaVariants([
    ...collectProviderSchemaVariants(left),
    ...collectProviderSchemaVariants(right),
  ]);

  if (variants.length === 1) {
    return left;
  }

  if (propertyName === "action") {
    const actionValues = variants.flatMap((variant) => {
      if (typeof variant.const === "string") {
        return [variant.const];
      }

      return Array.isArray(variant.enum)
        ? variant.enum.filter((value): value is string => typeof value === "string")
        : [];
    });

    if (actionValues.length > 0) {
      const descriptions = variants
        .map((variant) => variant.description)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      const combinedDescription = descriptions.length > 0
        ? descriptions.join(" ")
        : undefined;

      return {
        type: "string",
        enum: Array.from(new Set(actionValues)),
        ...(combinedDescription ? { description: combinedDescription } : {}),
      };
    }
  }

  if (variants.length === 1) {
    return variants[0]!;
  }

  return {
    anyOf: variants,
  };
}

function collectProviderSchemaVariants(schema: Record<string, unknown>): Array<Record<string, unknown>> {
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  if (!anyOf) {
    return [schema];
  }

  return anyOf.flatMap((variant) => {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      return [];
    }

    return collectProviderSchemaVariants(variant as Record<string, unknown>);
  });
}

function dedupeSchemaVariants(variants: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const unique: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const serialized = JSON.stringify(variant);
    if (seen.has(serialized)) {
      continue;
    }

    seen.add(serialized);
    unique.push(variant);
  }

  return unique;
}

/**
 * Context passed to the resolvePermission callback when user approval is needed.
 */
export interface PermissionRequest {
  toolName: string;
  toolArgs: Record<string, unknown>;
  approvalMessage: string;
}

export interface AskUserQuestionRequest {
  question: string;
  options: string[];
  allowFreeform: boolean;
}

export interface EngineLifecycleContext {
  sessionId?: string | null;
  turnCount?: number;
  toolName?: string;
  toolCallId?: string;
  toolInput?: unknown;
  toolSuccess?: boolean;
  error?: Error;
}

export interface QueryEngineOptions {
  /** Maximum number of turns before forcing termination */
  maxTurns?: number;
  /** Provider to use for completions */
  provider: Provider;
  /** Available tools */
  tools: Tool[];
  /** System prompt */
  systemPrompt?: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Callback for stream events */
  onEvent?: (event: StreamEvent) => void;
  /** Callback for tool execution */
  onToolExecute?: (toolName: string, input: unknown) => void;
  /** Permission manager for tool access control */
  permissionManager?: PermissionManager;
  /** Working directory for tool execution */
  cwd?: string;
  /** Shell compaction behavior forwarded to tools */
  shellCompactionMode?: "off" | "auto" | "aggressive";
  /** Session persistence surface for resumable approvals / memory tools */
  sessionStore?: SessionStore;
  /** Session id getter because interactive sessions are created lazily */
  getSessionId?: () => string | null;
  /** Optional extension directories for integration tooling */
  extensionDirs?: string[];
  /** Loaded runtime skills for integration-aware tools */
  skills?: Skill[];
  /** Loaded runtime MCP configurations for integration-aware tools */
  mcpServers?: McpServerConfig[];
  /**
   * Async callback invoked when a tool requires user approval and the
   * PermissionManager returns "ask". The UI should present a dialog and
   * resolve the returned promise with the user's decision.
   * If not provided, "ask" decisions are treated as "deny".
   */
  resolvePermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
  /** Callback for AskUserQuestion tool prompts in interactive mode */
  resolveQuestion?: (request: AskUserQuestionRequest) => Promise<string>;
  /** Lifecycle callback used by the runtime hook registry */
  onLifecycleEvent?: (event: "tool:before" | "tool:after" | "error", context: EngineLifecycleContext) => Promise<void> | void;
}

export interface QueryResult {
  /** Final messages in the conversation */
  messages: Message[];
  /** Terminal state */
  state: EngineState;
  /** Whether the query completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Token usage summary */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

type EngineExecutionMode = "process" | "stream";

interface PendingToolCall {
  id: string;
  name: string;
  input: unknown;
}

interface ToolCallExecutionOutcome {
  message: Message;
  events: StreamEvent[];
}

export class QueryEngine {
  private options: Required<Pick<QueryEngineOptions, "maxTurns" | "provider" | "tools" | "systemPrompt">> & {
    signal?: AbortSignal;
    onEvent?: (event: StreamEvent) => void;
    onToolExecute?: (toolName: string, input: unknown) => void;
    permissionManager?: import("../runtime/permissionManager.js").PermissionManager;
    cwd?: string;
    shellCompactionMode?: "off" | "auto" | "aggressive";
    sessionStore?: SessionStore;
    getSessionId?: () => string | null;
    extensionDirs?: string[];
    skills?: Skill[];
    mcpServers?: McpServerConfig[];
    resolvePermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
    resolveQuestion?: (request: AskUserQuestionRequest) => Promise<string>;
    onLifecycleEvent?: (event: "tool:before" | "tool:after" | "error", context: EngineLifecycleContext) => Promise<void> | void;
  };
  private readonly toolRegistry: ToolRegistry;

  constructor(options: QueryEngineOptions) {
    const toolRegistry = new ToolRegistry();
    toolRegistry.registerMany(options.tools);

    this.options = {
      maxTurns: options.maxTurns ?? 50,
      provider: options.provider,
      tools: options.tools,
      systemPrompt: options.systemPrompt ?? "",
      signal: options.signal,
      onEvent: options.onEvent,
      onToolExecute: options.onToolExecute,
      permissionManager: options.permissionManager,
      cwd: options.cwd,
      shellCompactionMode: options.shellCompactionMode,
      sessionStore: options.sessionStore,
      getSessionId: options.getSessionId,
      extensionDirs: options.extensionDirs,
      skills: options.skills,
      mcpServers: options.mcpServers,
      resolvePermission: options.resolvePermission,
      resolveQuestion: options.resolveQuestion,
      onLifecycleEvent: options.onLifecycleEvent,
    };
    this.toolRegistry = toolRegistry;
  }

  /**
   * Process a query with the given messages.
   * Returns a QueryResult with the final state.
   */
  async process(messages: Message[]): Promise<QueryResult> {
    const conversation = [...messages];
    let turnCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (turnCount < this.options.maxTurns) {
      // Check for abort
      if (this.options.signal?.aborted) {
        this.emit("done", { reason: "aborted" });
        return {
          messages: conversation,
          state: "interrupted",
          success: false,
          error: "Query was interrupted",
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      turnCount++;
      this.emit("progress", { turn: turnCount, maxTurns: this.options.maxTurns });

      // Build tool definitions for the provider
      const toolDefs = this.getProviderToolDefinitions();

      // Get completion from provider
      let response: ProviderResponse;
      try {
        response = await this.options.provider.complete(conversation, {
          systemPrompt: this.options.systemPrompt,
          tools: toolDefs,
          abortSignal: this.options.signal,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("error", { message });
        await this.fireErrorLifecycleEvent(message, {
          sessionId: this.options.getSessionId?.() ?? null,
          turnCount,
        });
        return {
          messages: conversation,
          state: "error",
          success: false,
          error: `Provider error: ${message}`,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // Add assistant response to conversation
      const assistantMessage: Message = {
        role: "assistant",
        content: response.text,
        metadata: { toolCalls: response.toolCalls },
      };
      conversation.push(assistantMessage);

      if (response.stopReason === "error") {
        const errorMessage = response.text.trim() || "Provider error";
        this.emit("error", { message: errorMessage });
        await this.fireErrorLifecycleEvent(errorMessage, {
          sessionId: this.options.getSessionId?.() ?? null,
          turnCount,
        });
        this.emit("done", { reason: "error" });
        return {
          messages: conversation,
          state: "error",
          success: false,
          error: errorMessage,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Check if the model wants to use tools
      if (response.toolCalls.length > 0) {
        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const outcome = await this.executeToolCall(toolCall, turnCount, "process");
          for (const event of outcome.events) {
            this.options.onEvent?.(event);
          }
          conversation.push(outcome.message);
        }

        // Continue the loop — model will get tool results and respond
        continue;
      }

      // No tool calls — check stop reason
      if (response.stopReason === "end_turn" || response.stopReason === "stop_sequence") {
        this.emit("done", { reason: response.stopReason });
        return {
          messages: conversation,
          state: "success",
          success: true,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      if (response.stopReason === "max_tokens") {
        this.emit("done", { reason: "max_tokens" });
        return {
          messages: conversation,
          state: "max_turns_reached",
          success: false,
          error: "Response exceeded max tokens",
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }
    }

    // Max turns reached
    this.emit("done", { reason: "max_turns" });
    return {
      messages: conversation,
      state: "max_turns_reached",
      success: false,
      error: `Exceeded maximum turns (${this.options.maxTurns})`,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  /**
   * Stream a query, yielding events as they occur.
   */
  async *stream(messages: Message[]): AsyncGenerator<StreamEvent, QueryResult, void> {
    const conversation = [...messages];
    let turnCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (turnCount < this.options.maxTurns) {
      if (this.options.signal?.aborted) {
        yield emitStreamEvent("done", { reason: "aborted" });
        return {
          messages: conversation,
          state: "interrupted",
          success: false,
          error: "Query was interrupted",
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      turnCount++;
      yield emitStreamEvent("progress", { turn: turnCount });

      const toolDefs = this.getProviderToolDefinitions();

      let fullText = "";
      const toolCalls: PendingToolCall[] = [];
      let stopReason: ProviderResponse["stopReason"] = "end_turn";

      try {
        for await (const chunk of this.options.provider.stream(conversation, {
          systemPrompt: this.options.systemPrompt,
          tools: toolDefs,
          abortSignal: this.options.signal,
        })) {
          if (chunk.textDelta) {
            fullText += chunk.textDelta;
            yield emitStreamEvent("text_delta", { delta: chunk.textDelta });
          }

          if (chunk.toolCall) {
            toolCalls.push({
              id: chunk.toolCall.id,
              name: chunk.toolCall.name,
              input: chunk.toolCall.input,
            });
          }

          // Track token usage from metadata
          if (chunk.metadata?.usage) {
            const usage = chunk.metadata.usage as { inputTokens?: number; outputTokens?: number };
            if (usage.inputTokens) totalInputTokens += usage.inputTokens;
            if (usage.outputTokens) totalOutputTokens += usage.outputTokens;
          }

          if (typeof chunk.metadata?.stopReason === "string" && this.isProviderStopReason(chunk.metadata.stopReason)) {
            stopReason = chunk.metadata.stopReason;
          }

          if (chunk.done) {
            break;
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        yield emitStreamEvent("error", { message });
        await this.fireErrorLifecycleEvent(message, {
          sessionId: this.options.getSessionId?.() ?? null,
          turnCount,
        });
        return {
          messages: conversation,
          state: "error",
          success: false,
          error: `Provider error: ${message}`,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Add assistant message
      conversation.push({
        role: "assistant",
        content: fullText,
        metadata: { toolCalls },
      });

      if (stopReason === "error") {
        const errorMessage = fullText.trim() || "Provider error";
        yield emitStreamEvent("error", { message: errorMessage });
        await this.fireErrorLifecycleEvent(errorMessage, {
          sessionId: this.options.getSessionId?.() ?? null,
          turnCount,
        });
        yield emitStreamEvent("done", {
          reason: "error",
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        });
        return {
          messages: conversation,
          state: "error",
          success: false,
          error: errorMessage,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Execute tool calls if any
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const outcome = await this.executeToolCall(tc, turnCount, "stream");
          for (const event of outcome.events) {
            yield event;
          }
          conversation.push(outcome.message);
        }
        // Continue loop for next turn
        continue;
      }

      // No tool calls — determine stop reason and emit appropriate event
      yield emitStreamEvent("done", { reason: stopReason, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
      return {
        messages: conversation,
        state: stopReason === "max_tokens" ? "max_turns_reached" : "success",
        success: stopReason !== "max_tokens",
        ...(stopReason === "max_tokens" ? { error: "Response exceeded max tokens" } : {}),
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      };
    }

    yield emitStreamEvent("done", { reason: "max_turns", usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
    return {
      messages: conversation,
      state: "max_turns_reached",
      success: false,
      error: `Exceeded maximum turns (${this.options.maxTurns})`,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private emit(type: StreamEvent["type"], data: unknown) {
    this.options.onEvent?.(emitStreamEvent(type, data));
  }

  private getProviderToolDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.toolRegistry.getProviderDefinitions({
      providerId: this.options.provider.id,
      model: this.options.provider.model,
    }).map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: this.zodSchemaToJsonSchema(definition.inputSchema),
    }));
  }

  private createToolContext(): ToolContext {
    return {
      cwd: this.options.cwd ?? process.cwd(),
      signal: this.options.signal,
      permissionMode: this.options.permissionManager?.getMode() ?? "always-ask",
      runtime: {
        sessionId: this.options.getSessionId?.() ?? null,
        sessionStore: this.options.sessionStore,
        permissionManager: this.options.permissionManager,
        toolRegistry: this.toolRegistry,
        shellCompactionMode: this.options.shellCompactionMode,
        extensionDirs: this.options.extensionDirs,
        skills: this.options.skills,
        mcpServers: this.options.mcpServers,
      },
    };
  }

  private async fireLifecycleEvent(
    event: "tool:before" | "tool:after" | "error",
    context: EngineLifecycleContext,
  ): Promise<void> {
    await this.options.onLifecycleEvent?.(event, context);
  }

  private async fireErrorLifecycleEvent(message: string, context: EngineLifecycleContext = {}): Promise<void> {
    await this.fireLifecycleEvent("error", {
      ...context,
      error: context.error ?? new Error(message),
    });
  }

  private getApprovalRequest(
    tool: Tool,
    toolName: string,
    input: unknown,
    context: ToolContext,
  ): ToolApprovalRequest | null {
    const explicit = tool.buildApprovalRequest?.(input, context);
    if (explicit) {
      return explicit;
    }

    if (tool.requiresApproval?.(input) !== true) {
      return null;
    }

    return {
      toolName,
      toolArgs: this.toToolArgs(input),
      approvalMessage: tool.getApprovalMessage?.(input) ?? `Allow ${toolName}?`,
      riskLevel: "high",
      resumable: true,
    };
  }

  private zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
    if (schema && typeof schema === "object" && !("safeParse" in (schema as Record<string, unknown>))) {
      return normalizeProviderToolInputSchema(schema as Record<string, unknown>);
    }

    return normalizeProviderToolInputSchema(zodToJsonSchema(schema as any, {
      $refStrategy: "none",
    }) as Record<string, unknown>);
  }

  private isProviderStopReason(value: string): value is ProviderResponse["stopReason"] {
    return value === "end_turn"
      || value === "tool_use"
      || value === "max_tokens"
      || value === "stop_sequence"
      || value === "error";
  }

  private normalizeToolInput(input: unknown): unknown {
    if (typeof input !== "string") {
      return input;
    }

    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }

  private toToolArgs(input: unknown): Record<string, unknown> {
    return input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  }

  private extractAskUserQuestionRequest(data: unknown, fallbackInput: unknown): AskUserQuestionRequest | null {
    const candidate = isAskUserQuestionRequest(data)
      ? data
      : isInteractiveQuestionPayload(data)
        ? data
      : isAskUserQuestionFallbackInput(fallbackInput)
        ? {
            question: fallbackInput.question,
            options: fallbackInput.options ?? [],
            allowFreeform: fallbackInput.allow_freeform ?? true,
          }
        : null;

    return candidate;
  }

  private async executeToolCall(
    toolCall: PendingToolCall,
    turnCount: number,
    mode: EngineExecutionMode,
  ): Promise<ToolCallExecutionOutcome> {
    const rawInput = this.normalizeToolInput(toolCall.input);
    const registration = this.toolRegistry.getRegistration(toolCall.name);

    if (!registration) {
      const errorMsg = `Unknown tool: ${toolCall.name}`;
      await this.fireErrorLifecycleEvent(errorMsg, {
        sessionId: this.options.getSessionId?.() ?? null,
        turnCount,
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        toolInput: rawInput,
      });

      return {
        message: {
          role: "tool",
          content: errorMsg,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        events: [emitStreamEvent("error", { tool: toolCall.name, message: errorMsg })],
      };
    }

    const tool = registration.tool;
    const toolContext = this.createToolContext();
    const normalizedInput = tool.normalizeInput?.(rawInput, toolContext) ?? rawInput;

    const denial = await this.resolveToolCallApproval({
      tool,
      toolCall,
      registration,
      toolContext,
      normalizedInput,
      turnCount,
    });
    if (denial) {
      return denial;
    }

    if (mode === "process") {
      this.options.onToolExecute?.(registration.canonicalName, normalizedInput);
    }

    const events = [emitStreamEvent("tool_call", {
      tool: registration.canonicalName,
      requestedToolName: toolCall.name,
      qualifiedToolName: registration.qualifiedName,
      category: registration.category,
      input: normalizedInput,
      toolCallId: toolCall.id,
    })];

    await this.fireLifecycleEvent("tool:before", {
      sessionId: this.options.getSessionId?.() ?? null,
      turnCount,
      toolName: registration.canonicalName,
      toolCallId: toolCall.id,
      toolInput: normalizedInput,
    });

    try {
      const startedAt = Date.now();
      const result = await tool.execute(normalizedInput, toolContext);
      const durationMs = Date.now() - startedAt;
      const outputBase = result.success ? result.output : (result.error ?? result.output);
      const output = result.truncated ? `${outputBase}\n[Output truncated]` : outputBase;
      const askUserRequest = this.extractAskUserQuestionRequest(result.data, normalizedInput);

      if (askUserRequest && this.options.resolveQuestion) {
        const answer = await this.options.resolveQuestion(askUserRequest);
        await this.fireLifecycleEvent("tool:after", {
          sessionId: this.options.getSessionId?.() ?? null,
          turnCount,
          toolName: registration.canonicalName,
          toolCallId: toolCall.id,
          toolInput: normalizedInput,
          toolSuccess: true,
        });

        return {
          message: {
            role: "tool",
            content: answer,
            toolCallId: toolCall.id,
            toolName: registration.canonicalName,
            metadata: {
              success: true,
              durationMs,
              input: normalizedInput,
              question: askUserRequest.question,
              answer,
              options: askUserRequest.options,
              allowFreeform: askUserRequest.allowFreeform,
              toolCallId: toolCall.id,
              canonicalToolName: registration.canonicalName,
              qualifiedToolName: registration.qualifiedName,
              requestedToolName: toolCall.name,
            },
          },
          events: [
            ...events,
            emitStreamEvent("tool_result", {
              tool: registration.canonicalName,
              success: true,
              input: normalizedInput,
              answer,
              question: askUserRequest.question,
              toolCallId: toolCall.id,
            }),
          ],
        };
      }

      await this.fireLifecycleEvent("tool:after", {
        sessionId: this.options.getSessionId?.() ?? null,
        turnCount,
        toolName: registration.canonicalName,
        toolCallId: toolCall.id,
        toolInput: normalizedInput,
        toolSuccess: result.success,
        ...(result.success ? {} : { error: new Error(result.error ?? result.output) }),
      });

      return {
        message: {
          role: "tool",
          content: output,
          toolCallId: toolCall.id,
          toolName: registration.canonicalName,
          metadata: {
            success: result.success,
            durationMs,
            input: normalizedInput,
            truncated: result.truncated ?? false,
            summary: result.summary,
            debug: result.debug,
            toolCallId: toolCall.id,
            canonicalToolName: registration.canonicalName,
            qualifiedToolName: registration.qualifiedName,
            requestedToolName: toolCall.name,
            category: registration.category,
            ...(result.error ? { error: result.error } : {}),
            ...(result.data !== undefined ? { data: result.data } : {}),
          },
        },
        events: [
          ...events,
          emitStreamEvent("tool_result", {
            tool: registration.canonicalName,
            success: result.success,
            input: normalizedInput,
            output,
            durationMs,
            truncated: result.truncated ?? false,
            summary: result.summary,
            toolCallId: toolCall.id,
            qualifiedToolName: registration.qualifiedName,
            requestedToolName: toolCall.name,
            category: registration.category,
            ...(result.error ? { error: result.error } : {}),
            ...(result.data !== undefined ? { data: result.data } : {}),
          }),
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const error = err instanceof Error ? err : new Error(message);

      await this.fireLifecycleEvent("tool:after", {
        sessionId: this.options.getSessionId?.() ?? null,
        turnCount,
        toolName: registration.canonicalName,
        toolCallId: toolCall.id,
        toolInput: normalizedInput,
        toolSuccess: false,
        error,
      });
      await this.fireErrorLifecycleEvent(message, {
        sessionId: this.options.getSessionId?.() ?? null,
        turnCount,
        toolName: registration.canonicalName,
        toolCallId: toolCall.id,
        toolInput: normalizedInput,
        error,
      });

      const output = mode === "process"
        ? `Tool execution error: ${message}`
        : `Tool error: ${message}`;

      return {
        message: {
          role: "tool",
          content: output,
          toolCallId: toolCall.id,
          toolName: registration.canonicalName,
          metadata: {
            success: false,
            input: normalizedInput,
            error: message,
            toolCallId: toolCall.id,
            canonicalToolName: registration.canonicalName,
            qualifiedToolName: registration.qualifiedName,
            requestedToolName: toolCall.name,
          },
        },
        events: [
          ...events,
          emitStreamEvent("tool_result", {
            tool: registration.canonicalName,
            success: false,
            input: normalizedInput,
            output,
            error: message,
            toolCallId: toolCall.id,
            qualifiedToolName: registration.qualifiedName,
            requestedToolName: toolCall.name,
          }),
        ],
      };
    }
  }

  private async resolveToolCallApproval(params: {
    tool: Tool;
    toolCall: PendingToolCall;
    registration: NonNullable<ReturnType<ToolRegistry["getRegistration"]>>;
    toolContext: ToolContext;
    normalizedInput: unknown;
    turnCount: number;
  }): Promise<ToolCallExecutionOutcome | null> {
    const approvalRequest = this.getApprovalRequest(
      params.tool,
      params.registration.canonicalName,
      params.normalizedInput,
      params.toolContext,
    );
    const needsApproval = Boolean(approvalRequest);

    if (!approvalRequest) {
      return null;
    }

    if (this.options.permissionManager) {
      let permissionResult = await this.options.permissionManager.checkPermission({
        toolName: params.registration.canonicalName,
        toolArgs: approvalRequest.toolArgs,
        riskLevel: approvalRequest.riskLevel ?? "high",
        reason: approvalRequest.reason,
        sessionId: this.options.getSessionId?.() ?? null,
        toolCallId: params.toolCall.id,
      });

      if (permissionResult.decision === "ask") {
        const pendingApproval = this.options.permissionManager.createPendingApproval({
          sessionId: this.options.getSessionId?.() ?? null,
          toolCallId: params.toolCall.id,
          toolName: params.registration.canonicalName,
          toolArgs: approvalRequest.toolArgs,
          approvalMessage: approvalRequest.approvalMessage,
        });

        if (this.options.resolvePermission) {
          const userDecision = await this.options.resolvePermission({
            toolName: params.registration.canonicalName,
            toolArgs: approvalRequest.toolArgs,
            approvalMessage: approvalRequest.approvalMessage,
          });
          if (pendingApproval) {
            this.options.permissionManager.resolvePendingApproval(pendingApproval.id, userDecision);
          }
          permissionResult = {
            decision: userDecision,
            persisted: userDecision === "allow-always",
            reason: "User decision",
          };
        } else {
          if (pendingApproval) {
            this.options.permissionManager.resolvePendingApproval(pendingApproval.id, "deny");
          }
          permissionResult = { decision: "deny", reason: "No interactive approval available" };
        }
      }

      if (permissionResult.decision === "deny") {
        await this.fireLifecycleEvent("tool:after", {
          sessionId: this.options.getSessionId?.() ?? null,
          turnCount: params.turnCount,
          toolName: params.registration.canonicalName,
          toolCallId: params.toolCall.id,
          toolInput: params.normalizedInput,
          toolSuccess: false,
          error: new Error(permissionResult.reason ?? "Permission denied"),
        });

        return {
          message: {
            role: "tool",
            content: `Tool execution denied: ${permissionResult.reason ?? "Permission denied"}`,
            toolCallId: params.toolCall.id,
            toolName: params.registration.canonicalName,
            metadata: {
              success: false,
              input: params.normalizedInput,
              error: permissionResult.reason ?? "Permission denied",
              toolCallId: params.toolCall.id,
              canonicalToolName: params.registration.canonicalName,
              qualifiedToolName: params.registration.qualifiedName,
              requestedToolName: params.toolCall.name,
              approvalMessage: approvalRequest.approvalMessage,
            },
          },
          events: [emitStreamEvent("permission_denied", {
            tool: params.registration.canonicalName,
            input: params.normalizedInput,
            reason: permissionResult.reason,
            approvalMessage: approvalRequest.approvalMessage,
          })],
        };
      }

      this.options.permissionManager.recordDecision(
        params.registration.canonicalName,
        permissionResult.decision,
        permissionResult.persisted ?? false,
      );
      return null;
    }

    if (!needsApproval) {
      return null;
    }

    await this.fireLifecycleEvent("tool:after", {
      sessionId: this.options.getSessionId?.() ?? null,
      turnCount: params.turnCount,
      toolName: params.registration.canonicalName,
      toolCallId: params.toolCall.id,
      toolInput: params.normalizedInput,
      toolSuccess: false,
      error: new Error("No permission manager configured"),
    });

    return {
      message: {
        role: "tool",
        content: "Tool execution denied (no permission manager configured)",
        toolCallId: params.toolCall.id,
        toolName: params.registration.canonicalName,
        metadata: {
          success: false,
          input: params.normalizedInput,
          error: "No permission manager configured",
          toolCallId: params.toolCall.id,
          canonicalToolName: params.registration.canonicalName,
          qualifiedToolName: params.registration.qualifiedName,
          requestedToolName: params.toolCall.name,
        },
      },
      events: [emitStreamEvent("permission_denied", {
        tool: params.registration.canonicalName,
        input: params.normalizedInput,
        reason: "No permission manager configured",
      })],
    };
  }
}

function isInteractiveQuestionPayload(value: unknown): value is AskUserQuestionRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { interaction?: unknown; question?: unknown; options?: unknown; allowFreeform?: unknown };
  return candidate.interaction === "question"
    && typeof candidate.question === "string"
    && Array.isArray(candidate.options)
    && candidate.options.every((option) => typeof option === "string")
    && typeof candidate.allowFreeform === "boolean";
}

function isAskUserQuestionRequest(value: unknown): value is AskUserQuestionRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AskUserQuestionRequest>;
  return typeof candidate.question === "string"
    && Array.isArray(candidate.options)
    && candidate.options.every((option) => typeof option === "string")
    && typeof candidate.allowFreeform === "boolean";
}

function isAskUserQuestionFallbackInput(value: unknown): value is {
  question: string;
  options?: string[];
  allow_freeform?: boolean;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    question?: unknown;
    options?: unknown;
    allow_freeform?: unknown;
  };

  return typeof candidate.question === "string"
    && (candidate.options === undefined || (Array.isArray(candidate.options) && candidate.options.every((option) => typeof option === "string")))
    && (candidate.allow_freeform === undefined || typeof candidate.allow_freeform === "boolean");
}
