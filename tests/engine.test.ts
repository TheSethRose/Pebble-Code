import { describe, expect, test } from "bun:test";
import { QueryEngine } from "../src/engine/QueryEngine";
import type { Message } from "../src/engine/types";
import type { Provider, ProviderCapabilities, ProviderOptions, ProviderResponse, StreamChunk } from "../src/providers/types";

class StubProvider implements Provider {
  readonly id = "stub";
  readonly name = "Stub Provider";
  readonly model = "stub-model";

  constructor(
    private readonly response: ProviderResponse,
    private readonly streamChunks: StreamChunk[] = [],
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  completeCalls = 0;

  async complete(_messages: Message[], _options?: ProviderOptions): Promise<ProviderResponse> {
    this.completeCalls += 1;
    return this.response;
  }

  async *stream(_messages: Message[], _options?: ProviderOptions): AsyncIterable<StreamChunk> {
    for (const chunk of this.streamChunks) {
      yield chunk;
    }
  }

  isConfigured(): boolean {
    return true;
  }
}

describe("QueryEngine provider error handling", () => {
  test("stops immediately when the provider returns an error stop reason", async () => {
    const provider = new StubProvider({
      text: "Provider error: 401 User not found.",
      toolCalls: [],
      stopReason: "error",
      usage: { inputTokens: 12, outputTokens: 3 },
    });

    const engine = new QueryEngine({
      provider,
      tools: [],
      maxTurns: 50,
    });

    const result = await engine.process([{ role: "user", content: "Hello" }]);

    expect(provider.completeCalls).toBe(1);
    expect(result.state).toBe("error");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Provider error: 401 User not found.");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      content: "Provider error: 401 User not found.",
    });
  });

  test("streaming mode emits an error and finishes when the provider reports an error stop reason", async () => {
    const provider = new StubProvider(
      {
        text: "unused",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      [
        {
          textDelta: "Provider error: 401 User not found.",
          done: true,
          metadata: { stopReason: "error" },
        },
      ],
    );

    const engine = new QueryEngine({
      provider,
      tools: [],
    });

    const events = [] as Array<{ type: string; data: unknown }>;
    for await (const event of engine.stream([{ role: "user", content: "Hello" }])) {
      events.push({ type: event.type, data: event.data });
    }

    expect(events).toEqual([
      { type: "progress", data: { turn: 1 } },
      { type: "text_delta", data: { delta: "Provider error: 401 User not found." } },
      { type: "error", data: { message: "Provider error: 401 User not found." } },
      {
        type: "done",
        data: { reason: "error", usage: { inputTokens: 0, outputTokens: 0 } },
      },
    ]);
  });
});