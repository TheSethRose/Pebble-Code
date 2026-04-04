/**
 * Query engine — the heart of Pebble Code.
 *
 * Processes multi-turn conversations with tool-use cycles,
 * streaming responses, and bounded recursion.
 */

import type { Provider, StreamChunk, ProviderResponse, ProviderToolDefinition } from "../providers/types.js";
import type { Tool } from "../tools/Tool.js";
import type { Message, StreamEvent, EngineState } from "./types.js";
import { createResultEnvelope } from "./results.js";
import { emitStreamEvent } from "./transitions.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PermissionManager } from "../runtime/permissionManager.js";

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
  };

  constructor(options: QueryEngineOptions) {
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
    };
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
      const toolDefs = this.options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ? this.zodSchemaToJsonSchema(t.inputSchema) : {},
      }));

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

      // Check if the model wants to use tools
      if (response.toolCalls.length > 0) {
        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const tool = this.options.tools.find((t) => t.name === toolCall.name);

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
          const needsApproval = tool.requiresApproval?.(toolCall.input) ?? false;
          if (needsApproval && this.options.permissionManager) {
            const permissionResult = await this.options.permissionManager.checkPermission({
              toolName: toolCall.name,
              toolArgs: toolCall.input as Record<string, unknown>,
              riskLevel: "high",
            });

            if (permissionResult.decision === "deny") {
              this.emit("permission_denied", { tool: toolCall.name, input: toolCall.input });
              conversation.push({
                role: "tool",
                content: `Tool execution denied: ${permissionResult.reason ?? "Permission denied"}`,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              });
              continue;
            }

            // Record the decision
            this.options.permissionManager.recordDecision(
              toolCall.name,
              permissionResult.decision,
              permissionResult.persisted ?? false,
            );
          } else if (needsApproval) {
            // No permission manager — deny by default
            this.emit("permission_denied", { tool: toolCall.name, input: toolCall.input });
            conversation.push({
              role: "tool",
              content: "Tool execution denied (no permission manager configured)",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            });
            continue;
          }

          // Execute the tool
          this.options.onToolExecute?.(tool.name, toolCall.input);
          this.emit("tool_call", { tool: toolCall.name, input: toolCall.input });

          try {
            const result = await tool.execute(toolCall.input, {
              cwd: this.options.cwd ?? process.cwd(),
              signal: this.options.signal,
              permissionMode: this.options.permissionManager?.getMode() ?? "always-ask",
            });

            const output = result.truncated ? `${result.output}\n[Output truncated]` : result.output;
            conversation.push({
              role: "tool",
              content: output,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              metadata: { success: result.success },
            });

            this.emit("tool_result", { tool: toolCall.name, success: result.success });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            conversation.push({
              role: "tool",
              content: `Tool execution error: ${message}`,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              metadata: { success: false },
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
  async *stream(messages: Message[]): AsyncIterable<StreamEvent> {
    const conversation = [...messages];
    let turnCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (turnCount < this.options.maxTurns) {
      if (this.options.signal?.aborted) {
        yield emitStreamEvent("done", { reason: "aborted" });
        return;
      }

      turnCount++;
      yield emitStreamEvent("progress", { turn: turnCount });

      const toolDefs = this.options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ? this.zodSchemaToJsonSchema(t.inputSchema) : {},
      }));

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

          if (chunk.done) {
            break;
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        yield emitStreamEvent("error", { message });
        return;
      }

      // Add assistant message
      conversation.push({
        role: "assistant",
        content: fullText,
        metadata: { toolCalls },
      });

      // Execute tool calls if any
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const tool = this.options.tools.find((t) => t.name === tc.name);
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

          let input: unknown;
          try {
            input = JSON.parse(tc.input);
          } catch {
            input = tc.input;
          }

          // Check approval via PermissionManager
          const needsApproval = tool.requiresApproval?.(input) ?? false;
          if (needsApproval && this.options.permissionManager) {
            const permissionResult = await this.options.permissionManager.checkPermission({
              toolName: tc.name,
              toolArgs: input as Record<string, unknown>,
              riskLevel: "high",
            });

            if (permissionResult.decision === "deny") {
              yield emitStreamEvent("permission_denied", { tool: tc.name, input });
              conversation.push({
                role: "tool",
                content: `Tool execution denied: ${permissionResult.reason ?? "Permission denied"}`,
                toolCallId: tc.id,
                toolName: tc.name,
              });
              continue;
            }

            this.options.permissionManager.recordDecision(
              tc.name,
              permissionResult.decision,
              permissionResult.persisted ?? false,
            );
          } else if (needsApproval) {
            yield emitStreamEvent("permission_denied", { tool: tc.name, input });
            conversation.push({
              role: "tool",
              content: "Tool execution denied (no permission manager configured)",
              toolCallId: tc.id,
              toolName: tc.name,
            });
            continue;
          }

          try {
            const result = await tool.execute(input, {
              cwd: this.options.cwd ?? process.cwd(),
              signal: this.options.signal,
              permissionMode: this.options.permissionManager?.getMode() ?? "always-ask",
            });
            conversation.push({
              role: "tool",
              content: result.output,
              toolCallId: tc.id,
              toolName: tc.name,
            });
            yield emitStreamEvent("tool_result", { tool: tc.name, success: result.success });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            conversation.push({
              role: "tool",
              content: `Tool error: ${message}`,
              toolCallId: tc.id,
              toolName: tc.name,
            });
            yield emitStreamEvent("error", { tool: tc.name, message });
          }
        }
        // Continue loop for next turn
        continue;
      }

      // No tool calls — determine stop reason and emit appropriate event
      yield emitStreamEvent("done", { reason: stopReason, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
      return;
    }

    yield emitStreamEvent("done", { reason: "max_turns", usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private emit(type: StreamEvent["type"], data: unknown) {
    this.options.onEvent?.(emitStreamEvent(type, data));
  }

  private zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
    return zodToJsonSchema(schema as any) as Record<string, unknown>;
  }
}
