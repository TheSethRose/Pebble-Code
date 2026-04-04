import type {
  Provider,
  ProviderCapabilities,
  ProviderOptions,
  ProviderResponse,
  StreamChunk,
} from "../types.js";
import type { Message } from "../../engine/types.js";

/**
 * Primary provider adapter.
 * Connects to the configured LLM API.
 */
export class PrimaryProvider implements Provider {
  readonly id = "primary";
  readonly name = "Primary Provider";
  readonly model: string;
  private apiKey: string;

  constructor(options: { apiKey: string; model: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
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
    _messages: Message[],
    _options?: ProviderOptions,
  ): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      return {
        text: "Provider not configured — set PEBBLE_API_KEY to enable.",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    // Stub: would make actual API call
    return {
      text: "Provider API call would go here.",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async *stream(
    _messages: Message[],
    _options?: ProviderOptions,
  ): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      yield {
        textDelta: "Provider not configured — set PEBBLE_API_KEY to enable.",
        done: true,
      };
      return;
    }

    // Stub: would stream from actual API
    yield { textDelta: "Streaming response stub.", done: false };
    yield { done: true };
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }
}

/**
 * Create a provider from environment/config.
 */
export function createPrimaryProvider(model?: string): PrimaryProvider {
  const apiKey = process.env.PEBBLE_API_KEY ?? "";
  const modelName = model ?? process.env.PEBBLE_MODEL ?? "default-model";

  return new PrimaryProvider({
    apiKey,
    model: modelName,
  });
}
