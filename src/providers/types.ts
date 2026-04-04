/**
 * Provider abstraction layer.
 *
 * Providers are the bridge between the engine and AI model APIs.
 * Each provider adapter handles auth, request formatting, streaming,
 * and response parsing for a specific model family.
 */

import type { Message } from "../engine/types.js";

/**
 * Capabilities that a provider/model may support.
 */
export interface ProviderCapabilities {
  /** Supports streaming via SSE/chunked transfer */
  streaming: boolean;
  /** Supports tool/function calling */
  toolUse: boolean;
  /** Supports system prompts */
  systemPrompt: boolean;
  /** Supports multi-modal input (images, etc.) */
  multimodal: boolean;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Supports parallel tool calls */
  parallelToolCalls: boolean;
}

/**
 * A single chunk from a streaming response.
 */
export interface StreamChunk {
  /** Text content delta */
  textDelta?: string;
  /** Tool call being made */
  toolCall?: ToolCall;
  /** Whether this is the final chunk */
  done: boolean;
  /** Raw provider metadata (usage, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * A tool call requested by the model.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Complete non-streaming response.
 */
export interface ProviderResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Provider interface for AI model interactions.
 */
export interface Provider {
  /** Unique provider identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Model identifier */
  readonly model: string;

  /** Get capabilities for this provider/model combo */
  getCapabilities(): ProviderCapabilities;

  /** Send a non-streaming request */
  complete(
    messages: Message[],
    options?: ProviderOptions
  ): Promise<ProviderResponse>;

  /** Send a streaming request */
  stream(
    messages: Message[],
    options?: ProviderOptions
  ): AsyncIterable<StreamChunk>;

  /** Check if provider is properly configured */
  isConfigured(): boolean;
}

/**
 * Options for a provider request.
 */
export interface ProviderOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: ProviderToolDefinition[];
  abortSignal?: AbortSignal;
}

/**
 * Tool definition sent to the provider.
 */
export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Provider configuration from settings.
 */
export interface ProviderConfig {
  id: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
}
