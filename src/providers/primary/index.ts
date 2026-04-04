import type {
  Provider,
  ProviderCapabilities,
  ProviderOptions,
  ProviderResponse,
  StreamChunk,
} from "../types.js";
import type { Message } from "../../engine/types.js";
import OpenAI from "openai";
import {
  getProviderNotConfiguredMessage,
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from "../config.js";
import type { Settings } from "../../runtime/config.js";

/**
 * Primary provider adapter.
 * Connects to an OpenAI-compatible LLM API.
 */
export class PrimaryProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  private client: OpenAI | null = null;
  private readonly config: ResolvedProviderConfig;

  constructor(config: ResolvedProviderConfig) {
    this.config = config;
    this.id = config.providerId;
    this.name = config.providerLabel;
    this.model = config.model;
    if (config.transport === "openai-compatible" && config.runtimeReady) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      parallelToolCalls: true,
    };
  }

  async complete(
    messages: Message[],
    options?: ProviderOptions,
  ): Promise<ProviderResponse> {
    if (!this.client) {
      return {
        text: getProviderNotConfiguredMessage(this.config),
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    try {
      const openaiMessages = messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "tool" ? "tool" : m.role === "system" ? "system" : "user" as const,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolName ? { name: m.toolName } : {}),
      }));

      const tools = options?.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages as any,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        tools: tools?.length ? tools : undefined,
        stop: options?.stopSequences,
      }, {
        signal: options?.abortSignal,
      });

      const choice = response.choices[0];
      if (!choice) {
        return {
          text: "",
          toolCalls: [],
          stopReason: "error",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }

      const toolCalls = (choice.message.tool_calls ?? []).map((tc) => {
        const fn = "function" in tc ? tc.function : undefined;
        return {
          id: tc.id,
          name: fn?.name ?? "unknown",
          input: safeParseJson(fn?.arguments ?? "{}"),
        };
      });

      return {
        text: choice.message.content ?? "",
        toolCalls,
        stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      return {
        text: `Provider error: ${error instanceof Error ? error.message : String(error)}`,
        toolCalls: [],
        stopReason: "error",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  async *stream(
    messages: Message[],
    options?: ProviderOptions,
  ): AsyncIterable<StreamChunk> {
    if (!this.client) {
      yield {
        textDelta: getProviderNotConfiguredMessage(this.config),
        done: true,
      };
      return;
    }

    try {
      const openaiMessages = messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "tool" ? "tool" : m.role === "system" ? "system" : "user" as const,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolName ? { name: m.toolName } : {}),
      }));

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages as any,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        stream: true,
        tools: options?.tools?.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
      }, {
        signal: options?.abortSignal,
      });

      const partialToolCalls = new Map<number, {
        id: string;
        name: string;
        arguments: string;
      }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { textDelta: delta.content, done: false };
        }

        const deltaToolCalls = (delta as {
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        } | undefined)?.tool_calls;

        if (deltaToolCalls) {
          for (const toolCall of deltaToolCalls) {
            const index = toolCall.index ?? 0;
            const existing = partialToolCalls.get(index) ?? {
              id: toolCall.id ?? `tool-${index}`,
              name: "unknown",
              arguments: "",
            };

            if (toolCall.id) {
              existing.id = toolCall.id;
            }

            if (toolCall.function?.name) {
              existing.name = toolCall.function.name;
            }

            if (toolCall.function?.arguments) {
              existing.arguments += toolCall.function.arguments;
            }

            partialToolCalls.set(index, existing);
          }
        }

        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          if (finishReason === "tool_calls") {
            for (const [, toolCall] of [...partialToolCalls.entries()].sort((a, b) => a[0] - b[0])) {
              yield {
                toolCall: {
                  id: toolCall.id,
                  name: toolCall.name,
                  input: safeParseJson(toolCall.arguments),
                },
                done: false,
              };
            }
          }

          yield {
            done: true,
            metadata: {
              stopReason: finishReason === "tool_calls"
                ? "tool_use"
                : finishReason === "length"
                ? "max_tokens"
                : "end_turn",
            },
          };
          return;
        }
      }
    } catch (error) {
      yield {
        textDelta: `Provider error: ${error instanceof Error ? error.message : String(error)}`,
        done: true,
        metadata: {
          stopReason: "error",
        },
      };
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }
}

/**
 * Create a provider from environment/config.
 */
export function createPrimaryProvider(options: {
  settings?: Partial<Settings>;
  provider?: string;
  model?: string;
} = {}): Provider {
  return new PrimaryProvider(
    resolveProviderConfig(options.settings, {
      provider: options.provider,
      model: options.model,
    }),
  );
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
