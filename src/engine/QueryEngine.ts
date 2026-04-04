/**
 * Query engine — the heart of Pebble Code.
 *
 * Processes multi-turn conversations with tool-use cycles,
 * streaming responses, and bounded recursion.
 */

import type { Provider, StreamChunk, ProviderResponse } from "../providers/types.js";
import type { SessionStore } from "../persistence/sessionStore.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolApprovalRequest, ToolContext } from "../tools/Tool.js";
import type { Message, StreamEvent, EngineState } from "./types.js";
import { emitStreamEvent } from "./transitions.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PermissionManager } from "../runtime/permissionManager.js";
import type { PermissionDecision } from "../runtime/permissions.js";

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
  /** Session persistence surface for resumable approvals / memory tools */
  sessionStore?: SessionStore;
  /** Session id getter because interactive sessions are created lazily */
  getSessionId?: () => string | null;
  /** Optional extension directories for integration tooling */
  extensionDirs?: string[];
  /**
   * Async callback invoked when a tool requires user approval and the
   * PermissionManager returns "ask". The UI should present a dialog and
   * resolve the returned promise with the user's decision.
   * If not provided, "ask" decisions are treated as "deny".
   */
  resolvePermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
  /** Callback for AskUserQuestion tool prompts in interactive mode */
  resolveQuestion?: (request: AskUserQuestionRequest) => Promise<string>;
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

export class QueryEngine {
  private options: Required<Pick<QueryEngineOptions, "maxTurns" | "provider" | "tools" | "systemPrompt">> & {
    signal?: AbortSignal;
    onEvent?: (event: StreamEvent) => void;
    onToolExecute?: (toolName: string, input: unknown) => void;
    permissionManager?: import("../runtime/permissionManager.js").PermissionManager;
    cwd?: string;
    sessionStore?: SessionStore;
    getSessionId?: () => string | null;
    extensionDirs?: string[];
    resolvePermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
    resolveQuestion?: (request: AskUserQuestionRequest) => Promise<string>;
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
      sessionStore: options.sessionStore,
      getSessionId: options.getSessionId,
      extensionDirs: options.extensionDirs,
      resolvePermission: options.resolvePermission,
      resolveQuestion: options.resolveQuestion,
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
          const toolInput = this.normalizeToolInput(toolCall.input);
          const registration = this.toolRegistry.getRegistration(toolCall.name);
          const tool = registration?.tool;

          if (!tool) {
            // Unknown tool — report error to model
            const errorMsg = `Unknown tool: ${toolCall.name}`;
            this.emit("error", { tool: toolCall.name, message: errorMsg });
            conversation.push({
              role: "tool",
              content: errorMsg,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            });
            continue;
          }

          // Check approval via PermissionManager
          const toolContext = this.createToolContext();
          const approvalRequest = this.getApprovalRequest(tool, registration.canonicalName, toolInput, toolContext);
          const needsApproval = Boolean(approvalRequest);
            if (approvalRequest && this.options.permissionManager) {
              let permissionResult = await this.options.permissionManager.checkPermission({
                toolName: registration.canonicalName,
                toolArgs: approvalRequest.toolArgs,
                riskLevel: approvalRequest.riskLevel ?? "high",
                reason: approvalRequest.reason,
                sessionId: this.options.getSessionId?.() ?? null,
                toolCallId: toolCall.id,
              });

            // If the manager says "ask", delegate to the interactive resolver
            if (permissionResult.decision === "ask") {
              const pendingApproval = this.options.permissionManager.createPendingApproval({
                sessionId: this.options.getSessionId?.() ?? null,
                toolCallId: toolCall.id,
                toolName: registration.canonicalName,
                toolArgs: approvalRequest.toolArgs,
                approvalMessage: approvalRequest.approvalMessage,
              });

              if (this.options.resolvePermission) {
                const userDecision = await this.options.resolvePermission({
                  toolName: registration.canonicalName,
                  toolArgs: approvalRequest.toolArgs,
                  approvalMessage: approvalRequest.approvalMessage,
                });
                if (pendingApproval) {
                  this.options.permissionManager.resolvePendingApproval(pendingApproval.id, userDecision);
                }
                permissionResult = { decision: userDecision, reason: "User decision" };
              } else {
                if (pendingApproval) {
                  this.options.permissionManager.resolvePendingApproval(pendingApproval.id, "deny");
                }
                // No interactive resolver — deny by default
                permissionResult = { decision: "deny", reason: "No interactive approval available" };
              }
            }

            if (permissionResult.decision === "deny") {
              this.emit("permission_denied", {
                tool: registration.canonicalName,
                input: toolInput,
                reason: permissionResult.reason,
                approvalMessage: approvalRequest.approvalMessage,
              });
              conversation.push({
                role: "tool",
                content: `Tool execution denied: ${permissionResult.reason ?? "Permission denied"}`,
                toolCallId: toolCall.id,
                toolName: registration.canonicalName,
                metadata: {
                  success: false,
                  input: toolInput,
                  error: permissionResult.reason ?? "Permission denied",
                  toolCallId: toolCall.id,
                  canonicalToolName: registration.canonicalName,
                  qualifiedToolName: registration.qualifiedName,
                  requestedToolName: toolCall.name,
                  approvalMessage: approvalRequest.approvalMessage,
                },
              });
              continue;
            }

            // Record the decision
            this.options.permissionManager.recordDecision(
              registration.canonicalName,
              permissionResult.decision,
              permissionResult.persisted ?? false,
            );
          } else if (needsApproval) {
            // No permission manager — deny by default
            this.emit("permission_denied", {
              tool: registration.canonicalName,
              input: toolInput,
              reason: "No permission manager configured",
            });
            conversation.push({
              role: "tool",
              content: "Tool execution denied (no permission manager configured)",
              toolCallId: toolCall.id,
              toolName: registration.canonicalName,
              metadata: {
                success: false,
                input: toolInput,
                error: "No permission manager configured",
                toolCallId: toolCall.id,
                canonicalToolName: registration.canonicalName,
                qualifiedToolName: registration.qualifiedName,
                requestedToolName: toolCall.name,
              },
            });
            continue;
          }

          // Execute the tool
          this.options.onToolExecute?.(registration.canonicalName, toolInput);
          this.emit("tool_call", {
            tool: registration.canonicalName,
            requestedToolName: toolCall.name,
            qualifiedToolName: registration.qualifiedName,
            category: registration.category,
            input: toolInput,
            toolCallId: toolCall.id,
          });

          try {
            const startedAt = Date.now();
            const result = await tool.execute(toolInput, toolContext);

            const durationMs = Date.now() - startedAt;
            const outputBase = result.success ? result.output : (result.error ?? result.output);
            const output = result.truncated ? `${outputBase}\n[Output truncated]` : outputBase;

            const askUserRequest = this.extractAskUserQuestionRequest(result.data, toolInput);

            if (askUserRequest && this.options.resolveQuestion) {
              const answer = await this.options.resolveQuestion(askUserRequest);
              conversation.push({
                role: "tool",
                content: answer,
                toolCallId: toolCall.id,
                toolName: registration.canonicalName,
                metadata: {
                  success: true,
                  durationMs,
                  input: toolInput,
                  question: askUserRequest.question,
                  answer,
                  options: askUserRequest.options,
                  allowFreeform: askUserRequest.allowFreeform,
                  toolCallId: toolCall.id,
                  canonicalToolName: registration.canonicalName,
                  qualifiedToolName: registration.qualifiedName,
                  requestedToolName: toolCall.name,
                },
              });

              this.emit("tool_result", {
                tool: registration.canonicalName,
                success: true,
                input: toolInput,
                answer,
                question: askUserRequest.question,
                toolCallId: toolCall.id,
              });
              continue;
            }

            conversation.push({
              role: "tool",
              content: output,
              toolCallId: toolCall.id,
              toolName: registration.canonicalName,
              metadata: {
                success: result.success,
                durationMs,
                input: toolInput,
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
            });

            this.emit("tool_result", {
              tool: registration.canonicalName,
              success: result.success,
              input: toolInput,
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
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            conversation.push({
              role: "tool",
              content: `Tool execution error: ${message}`,
              toolCallId: toolCall.id,
              toolName: registration.canonicalName,
              metadata: {
                success: false,
                input: toolInput,
                error: message,
                toolCallId: toolCall.id,
                canonicalToolName: registration.canonicalName,
                qualifiedToolName: registration.qualifiedName,
                requestedToolName: toolCall.name,
              },
            });
            this.emit("tool_result", {
              tool: registration.canonicalName,
              success: false,
              input: toolInput,
              output: `Tool execution error: ${message}`,
              error: message,
              toolCallId: toolCall.id,
              qualifiedToolName: registration.qualifiedName,
              requestedToolName: toolCall.name,
            });
          }
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
      const toolCalls: { id: string; name: string; input: string }[] = [];
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
              input: JSON.stringify(chunk.toolCall.input),
            });
            yield emitStreamEvent("tool_call", {
              tool: chunk.toolCall.name,
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
          const registration = this.toolRegistry.getRegistration(tc.name);
          const tool = registration?.tool;
          if (!tool) {
            yield emitStreamEvent("error", { tool: tc.name, message: `Unknown tool: ${tc.name}` });
            conversation.push({
              role: "tool",
              content: `Unknown tool: ${tc.name}`,
              toolCallId: tc.id,
              toolName: tc.name,
            });
            continue;
          }

          const input = this.normalizeToolInput(tc.input);
          const toolContext = this.createToolContext();

          // Check approval via PermissionManager
          const approvalRequest = this.getApprovalRequest(tool, registration.canonicalName, input, toolContext);
          if (approvalRequest && this.options.permissionManager) {
            let permissionResult = await this.options.permissionManager.checkPermission({
              toolName: registration.canonicalName,
              toolArgs: approvalRequest.toolArgs,
              riskLevel: approvalRequest.riskLevel ?? "high",
              reason: approvalRequest.reason,
              sessionId: this.options.getSessionId?.() ?? null,
              toolCallId: tc.id,
            });

            if (permissionResult.decision === "ask") {
              const pendingApproval = this.options.permissionManager.createPendingApproval({
                sessionId: this.options.getSessionId?.() ?? null,
                toolCallId: tc.id,
                toolName: registration.canonicalName,
                toolArgs: approvalRequest.toolArgs,
                approvalMessage: approvalRequest.approvalMessage,
              });

              if (this.options.resolvePermission) {
                const userDecision = await this.options.resolvePermission({
                  toolName: registration.canonicalName,
                  toolArgs: approvalRequest.toolArgs,
                  approvalMessage: approvalRequest.approvalMessage,
                });
                if (pendingApproval) {
                  this.options.permissionManager.resolvePendingApproval(pendingApproval.id, userDecision);
                }
                permissionResult = { decision: userDecision, reason: "User decision" };
              } else {
                if (pendingApproval) {
                  this.options.permissionManager.resolvePendingApproval(pendingApproval.id, "deny");
                }
                permissionResult = { decision: "deny", reason: "No interactive approval available" };
              }
            }

            if (permissionResult.decision === "deny") {
              yield emitStreamEvent("permission_denied", {
                tool: registration.canonicalName,
                input,
                reason: permissionResult.reason,
                approvalMessage: approvalRequest.approvalMessage,
              });
              conversation.push({
                role: "tool",
                content: `Tool execution denied: ${permissionResult.reason ?? "Permission denied"}`,
                toolCallId: tc.id,
                toolName: registration.canonicalName,
                metadata: {
                  success: false,
                  input,
                  error: permissionResult.reason ?? "Permission denied",
                  toolCallId: tc.id,
                  canonicalToolName: registration.canonicalName,
                  qualifiedToolName: registration.qualifiedName,
                  requestedToolName: tc.name,
                  approvalMessage: approvalRequest.approvalMessage,
                },
              });
              continue;
            }

            this.options.permissionManager.recordDecision(
              registration.canonicalName,
              permissionResult.decision,
              permissionResult.persisted ?? false,
            );
          } else if (approvalRequest) {
            yield emitStreamEvent("permission_denied", {
              tool: registration.canonicalName,
              input,
              reason: "No permission manager configured",
            });
            conversation.push({
              role: "tool",
              content: "Tool execution denied (no permission manager configured)",
              toolCallId: tc.id,
              toolName: registration.canonicalName,
              metadata: {
                success: false,
                input,
                error: "No permission manager configured",
                toolCallId: tc.id,
                canonicalToolName: registration.canonicalName,
                qualifiedToolName: registration.qualifiedName,
                requestedToolName: tc.name,
              },
            });
            continue;
          }

          try {
            const startedAt = Date.now();
            const result = await tool.execute(input, toolContext);

            const durationMs = Date.now() - startedAt;
            const outputBase = result.success ? result.output : (result.error ?? result.output);
            const output = result.truncated ? `${outputBase}\n[Output truncated]` : outputBase;
            const askUserRequest = this.extractAskUserQuestionRequest(result.data, input);

            if (askUserRequest && this.options.resolveQuestion) {
              const answer = await this.options.resolveQuestion(askUserRequest);
              conversation.push({
                role: "tool",
                content: answer,
                toolCallId: tc.id,
                toolName: registration.canonicalName,
                metadata: {
                  success: true,
                  durationMs,
                  input,
                  question: askUserRequest.question,
                  answer,
                  toolCallId: tc.id,
                  canonicalToolName: registration.canonicalName,
                  qualifiedToolName: registration.qualifiedName,
                  requestedToolName: tc.name,
                },
              });
              yield emitStreamEvent("tool_result", {
                tool: registration.canonicalName,
                success: true,
                input,
                answer,
                question: askUserRequest.question,
                toolCallId: tc.id,
              });
              continue;
            }

            conversation.push({
              role: "tool",
              content: output,
              toolCallId: tc.id,
              toolName: registration.canonicalName,
              metadata: {
                success: result.success,
                durationMs,
                input,
                truncated: result.truncated ?? false,
                summary: result.summary,
                debug: result.debug,
                toolCallId: tc.id,
                canonicalToolName: registration.canonicalName,
                qualifiedToolName: registration.qualifiedName,
                requestedToolName: tc.name,
                category: registration.category,
                ...(result.error ? { error: result.error } : {}),
                ...(result.data !== undefined ? { data: result.data } : {}),
              },
            });
            yield emitStreamEvent("tool_result", {
              tool: registration.canonicalName,
              success: result.success,
              input,
              output,
              durationMs,
              truncated: result.truncated ?? false,
              summary: result.summary,
              toolCallId: tc.id,
              qualifiedToolName: registration.qualifiedName,
              requestedToolName: tc.name,
              category: registration.category,
              ...(result.error ? { error: result.error } : {}),
              ...(result.data !== undefined ? { data: result.data } : {}),
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            conversation.push({
              role: "tool",
              content: `Tool error: ${message}`,
              toolCallId: tc.id,
              toolName: registration.canonicalName,
              metadata: {
                success: false,
                input,
                error: message,
                toolCallId: tc.id,
                canonicalToolName: registration.canonicalName,
                qualifiedToolName: registration.qualifiedName,
                requestedToolName: tc.name,
              },
            });
            yield emitStreamEvent("tool_result", {
              tool: registration.canonicalName,
              success: false,
              input,
              output: `Tool error: ${message}`,
              error: message,
              toolCallId: tc.id,
              qualifiedToolName: registration.qualifiedName,
              requestedToolName: tc.name,
            });
          }
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
        extensionDirs: this.options.extensionDirs,
      },
    };
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
      return schema as Record<string, unknown>;
    }

    return zodToJsonSchema(schema as any) as Record<string, unknown>;
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
