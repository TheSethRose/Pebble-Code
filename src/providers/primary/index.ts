import type {
  Provider,
  ProviderCapabilities,
  ProviderOptions,
  ProviderResponse,
  StreamChunk,
} from "../types.js";
import type { Message } from "../../engine/types.js";
import OpenAI from "openai";

/**
 * Primary provider adapter.
 * Connects to an OpenAI-compatible LLM API.
 */
export class PrimaryProvider implements Provider {
  readonly id = "primary";
  readonly name = "Primary Provider";
  readonly model: string;
  private client: OpenAI | null = null;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.model = options.model;
    if (options.apiKey.length > 0) {
      this.client = new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
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
        text: "Provider not configured — set PEBBLE_API_KEY to enable.",
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
          input: fn?.arguments ?? "{}",
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
        textDelta: "Provider not configured — set PEBBLE_API_KEY to enable.",
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
      }, {
        signal: options?.abortSignal,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { textDelta: delta.content, done: false };
        }
        if (chunk.choices[0]?.finish_reason) {
          yield { done: true };
          return;
        }
      }
    } catch (error) {
      yield {
        textDelta: `Provider error: ${error instanceof Error ? error.message : String(error)}`,
        done: true,
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
export function createPrimaryProvider(model?: string): PrimaryProvider {
  const apiKey = process.env.PEBBLE_API_KEY ?? "";
  const modelName = model ?? process.env.PEBBLE_MODEL ?? "gpt-4o";
  const baseUrl = process.env.PEBBLE_API_BASE;

  return new PrimaryProvider({
    apiKey,
    model: modelName,
    baseUrl,
  });
}
