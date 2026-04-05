import type {
  Provider,
  ProviderCapabilities,
  ProviderOptions,
  ProviderResponse,
  StreamChunk,
} from "../types.js";
import type { Message } from "../../engine/types.js";
import type { ResponseInputItem, ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import {
  getProviderNotConfiguredMessage,
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from "../config.js";
import {
  getStoredProviderOAuthSession,
  type Settings,
} from "../../runtime/config.js";
import { resolveGitHubCopilotRuntimeAuth } from "../githubCopilot.js";
import { logGitHubCopilotDebug } from "../githubCopilotDebug.js";

/**
 * Primary provider adapter.
 * Connects to an OpenAI-compatible LLM API.
 */
export class PrimaryProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  private client: OpenAI | null = null;
  private clientExpiresAt: number | null = null;
  private readonly config: ResolvedProviderConfig;
  private readonly settings: Partial<Settings>;

  constructor(config: ResolvedProviderConfig, settings: Partial<Settings> = {}) {
    this.config = config;
    this.settings = settings;
    this.id = config.providerId;
    this.name = config.providerLabel;
    this.model = config.model;
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
    const client = await this.ensureClient();
    if (!client) {
      return {
        text: getProviderNotConfiguredMessage(this.config),
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    try {
      if (this.shouldUseResponsesApi()) {
        return await this.completeWithResponses(client, messages, options);
      }

      const openaiMessages = mapEngineMessagesToOpenAi(messages);

      const tools = options?.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      const response = await client.chat.completions.create({
        model: this.model,
        messages: openaiMessages as any,
        temperature: options?.temperature,
        tools: tools?.length ? tools : undefined,
        stop: options?.stopSequences,
        ...this.buildMaxTokensParam(options?.maxTokens),
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
    const client = await this.ensureClient();
    if (!client) {
      yield {
        textDelta: getProviderNotConfiguredMessage(this.config),
        done: true,
      };
      return;
    }

    try {
      if (this.shouldUseResponsesApi()) {
        yield* this.streamWithResponses(client, messages, options);
        return;
      }

      const openaiMessages = mapEngineMessagesToOpenAi(messages);

      const stream = await client.chat.completions.create({
        model: this.model,
        messages: openaiMessages as any,
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
        ...this.buildMaxTokensParam(options?.maxTokens),
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
    return this.config.runtimeReady;
  }

  private async ensureClient(): Promise<OpenAI | null> {
    if (this.config.transport !== "openai-compatible" || !this.config.runtimeReady) {
      return null;
    }

    const now = Date.now();
    if (this.client && (!this.clientExpiresAt || this.clientExpiresAt - now > 5 * 60_000)) {
      return this.client;
    }

    const prepared = await this.prepareClientConfig();
    this.client = new OpenAI({
      apiKey: prepared.apiKey,
      baseURL: prepared.baseURL,
      defaultHeaders: prepared.defaultHeaders,
    });
    this.clientExpiresAt = prepared.expiresAt ?? null;
    return this.client;
  }

  private async prepareClientConfig(): Promise<{
    apiKey: string;
    baseURL: string;
    defaultHeaders: Record<string, string>;
    expiresAt?: number;
  }> {
    if (this.config.providerId === "github-copilot") {
      const oauthSession = getStoredProviderOAuthSession(this.settings, this.config.providerId);
      const oauthAccessToken = oauthSession?.accessToken?.trim() || "";
      const oauthRefreshToken = oauthSession?.refreshToken?.trim() || "";
      const fallbackConfigToken = this.config.apiKey.trim();
      const githubToken = oauthAccessToken
        || oauthRefreshToken
        || fallbackConfigToken
        || "";
      logGitHubCopilotDebug("prepare_client_config", {
        providerId: this.config.providerId,
        model: this.model,
        hasOauthSession: Boolean(oauthSession),
        oauthTokenType: oauthSession?.tokenType ?? null,
        tokenSource: oauthAccessToken
          ? "oauth.accessToken"
          : oauthRefreshToken
            ? "oauth.refreshToken"
            : fallbackConfigToken
              ? "config.apiKey"
              : "missing",
      });
      const resolved = await resolveGitHubCopilotRuntimeAuth({ githubToken });
      return {
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
        defaultHeaders: { ...this.config.requestHeaders },
        expiresAt: resolved.expiresAt,
      };
    }

    return {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      defaultHeaders: { ...this.config.requestHeaders },
    };
  }

  private buildMaxTokensParam(maxTokens: number | undefined): Record<string, number> {
    if (typeof maxTokens !== "number") {
      return {};
    }

    if (this.config.providerId === "github-copilot" && /^gpt-5([.-]|$)/.test(this.model)) {
      return { max_completion_tokens: maxTokens };
    }

    return { max_tokens: maxTokens };
  }

  private shouldUseResponsesApi(): boolean {
    return this.config.providerId === "github-copilot" && /^gpt-5([.-]|$)/.test(this.model);
  }

  private async completeWithResponses(
    client: OpenAI,
    messages: Message[],
    options?: ProviderOptions,
  ): Promise<ProviderResponse> {
    const response = await client.responses.create({
      model: this.model,
      input: mapEngineMessagesToResponsesInput(messages),
      temperature: options?.temperature,
      tools: mapProviderToolsToResponsesTools(options?.tools),
      parallel_tool_calls: options?.tools?.length ? true : undefined,
      ...this.buildResponsesMaxTokensParam(options?.maxTokens),
    }, {
      signal: options?.abortSignal,
    });

    return {
      text: response.output_text ?? "",
      toolCalls: collectResponseToolCalls(response.output),
      stopReason: mapResponsesStopReason(response),
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }

  private async *streamWithResponses(
    client: OpenAI,
    messages: Message[],
    options?: ProviderOptions,
  ): AsyncIterable<StreamChunk> {
    const stream = await client.responses.create({
      model: this.model,
      input: mapEngineMessagesToResponsesInput(messages),
      temperature: options?.temperature,
      stream: true,
      tools: mapProviderToolsToResponsesTools(options?.tools),
      parallel_tool_calls: options?.tools?.length ? true : undefined,
      ...this.buildResponsesMaxTokensParam(options?.maxTokens),
    }, {
      signal: options?.abortSignal,
    });

    const pendingToolCalls = new Map<string, {
      streamItemId: string;
      surfacedId: string;
      name: string;
      arguments: string;
      argumentsComplete: boolean;
      emitted: boolean;
    }>();
    let stopReason: ProviderResponse["stopReason"] = "end_turn";

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        yield { textDelta: event.delta, done: false };
        continue;
      }

      if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
        const toolCall = extractResponseToolCall(event.item);
        if (!toolCall) {
          continue;
        }

        const streamItemId = event.item.id ?? toolCall.id;
        const existing = pendingToolCalls.get(streamItemId);
        const pendingToolCall = {
          streamItemId,
          surfacedId: normalizeResponsesToolCallId(toolCall.id, streamItemId),
          name: hasUsableToolCallName(toolCall.name) ? toolCall.name : (existing?.name ?? "unknown"),
          arguments: toolCall.arguments,
          argumentsComplete: existing?.argumentsComplete ?? false,
          emitted: existing?.emitted ?? false,
        };
        pendingToolCalls.set(streamItemId, pendingToolCall);

        if (pendingToolCall.argumentsComplete && hasUsableToolCallName(pendingToolCall.name) && !pendingToolCall.emitted) {
          pendingToolCall.emitted = true;
          stopReason = "tool_use";
          yield {
            toolCall: {
              id: pendingToolCall.surfacedId,
              name: pendingToolCall.name,
              input: safeParseJson(pendingToolCall.arguments),
            },
            done: false,
          };
        }
        continue;
      }

      if (event.type === "response.function_call_arguments.delta") {
        const existing = pendingToolCalls.get(event.item_id) ?? {
          streamItemId: event.item_id,
          surfacedId: normalizeResponsesToolCallId(event.item_id, event.item_id),
          name: "unknown",
          arguments: "",
          argumentsComplete: false,
          emitted: false,
        };
        existing.arguments += event.delta;
        pendingToolCalls.set(event.item_id, existing);
        continue;
      }

      if (event.type === "response.function_call_arguments.done") {
        const existing = pendingToolCalls.get(event.item_id) ?? {
          streamItemId: event.item_id,
          surfacedId: normalizeResponsesToolCallId(event.item_id, event.item_id),
          name: typeof event.name === "string" ? event.name : "unknown",
          arguments: event.arguments,
          argumentsComplete: false,
          emitted: false,
        };
        if (hasUsableToolCallName(event.name)) {
          existing.name = event.name;
        }
        existing.arguments = event.arguments;
        existing.argumentsComplete = true;
        pendingToolCalls.set(event.item_id, existing);

        if (hasUsableToolCallName(existing.name) && !existing.emitted) {
          existing.emitted = true;
          stopReason = "tool_use";
          yield {
            toolCall: {
              id: existing.surfacedId,
              name: existing.name,
              input: safeParseJson(existing.arguments),
            },
            done: false,
          };
        }
        continue;
      }

      if (event.type === "response.completed") {
        if (pendingToolCalls.size > 0) {
          for (const toolCall of pendingToolCalls.values()) {
            if (toolCall.emitted || !hasUsableToolCallName(toolCall.name)) {
              continue;
            }

            stopReason = "tool_use";
            yield {
              toolCall: {
                id: toolCall.surfacedId,
                name: toolCall.name,
                input: safeParseJson(toolCall.arguments),
              },
              done: false,
            };
          }
        }

        const reason = event.response.incomplete_details?.reason;
        if (reason === "max_output_tokens") {
          stopReason = "max_tokens";
        }

        yield {
          done: true,
          metadata: {
            stopReason,
          },
        };
        return;
      }
    }

    yield {
      done: true,
      metadata: {
        stopReason,
      },
    };
  }

  private buildResponsesMaxTokensParam(maxTokens: number | undefined): Record<string, number> {
    if (typeof maxTokens !== "number") {
      return {};
    }

    return { max_output_tokens: maxTokens };
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
    options.settings,
  );
}

function safeParseJson(value: string): unknown {
  let current: unknown = value;

  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "string") {
      return current;
    }

    const trimmed = current.trim();
    if (!looksLikeJson(trimmed)) {
      return current;
    }

    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }

  return current;
}

function mapEngineMessagesToOpenAi(messages: Message[]): Array<Record<string, unknown>> {
  return messages.flatMap((message) => {
    if (message.role === "progress") {
      return [];
    }

    if (message.role === "assistant") {
      const toolCalls = extractAssistantToolCalls(message);
      return [{
        role: "assistant",
        content: message.content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      }];
    }

    if (message.role === "tool") {
      return [{
        role: "tool",
        content: message.content,
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolName ? { name: message.toolName } : {}),
      }];
    }

    return [{
      role: message.role === "system" ? "system" : "user",
      content: message.content,
    }];
  });
}

function extractAssistantToolCalls(message: Message): Array<Record<string, unknown>> {
  const metadataToolCalls = message.metadata?.toolCalls;
  if (!Array.isArray(metadataToolCalls)) {
    return [];
  }

  return metadataToolCalls.flatMap((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") {
      return [];
    }

    const candidate = toolCall as {
      id?: unknown;
      name?: unknown;
      input?: unknown;
    };
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const name = typeof candidate.name === "string" ? candidate.name : "";
    if (!id || !name) {
      return [];
    }

    return [{
      id,
      type: "function",
      function: {
        name,
        arguments: serializeToolCallArguments(candidate.input),
      },
    }];
  });
}

function serializeToolCallArguments(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input ?? {});
}

function mapEngineMessagesToResponsesInput(messages: Message[]): ResponseInputItem[] {
  return messages.flatMap((message) => {
    if (message.role === "progress") {
      return [];
    }

    if (message.role === "user") {
      return [{
        type: "message",
        role: "user",
        content: message.content,
      }];
    }

    if (message.role === "system") {
      return [{
        type: "message",
        role: "system",
        content: message.content,
      }];
    }

    if (message.role === "assistant") {
      const items: ResponseInputItem[] = [];
      if (message.content.trim().length > 0) {
        items.push({
          id: `assistant-${items.length}`,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{
            type: "output_text",
            text: message.content,
            annotations: [],
          }],
        } as ResponseOutputItem as ResponseInputItem);
      }

      const toolCalls = extractAssistantToolCalls(message).map((toolCall, index) => ({
        type: "function_call" as const,
        call_id: normalizeResponsesToolCallId(
          typeof toolCall.id === "string" ? toolCall.id : undefined,
          `assistant-tool-${index}`,
        ),
        name: typeof (toolCall.function as { name?: unknown })?.name === "string"
          ? (toolCall.function as { name: string }).name
          : "unknown",
        arguments: typeof (toolCall.function as { arguments?: unknown })?.arguments === "string"
          ? (toolCall.function as { arguments: string }).arguments
          : "{}",
      }));

      return [...items, ...toolCalls];
    }

    if (message.role === "tool" && message.toolCallId) {
      return [{
        type: "function_call_output",
        call_id: normalizeResponsesToolCallId(message.toolCallId, message.toolName ?? "tool-output"),
        output: message.content,
      }];
    }

    return [];
  });
}

function mapProviderToolsToResponsesTools(
  tools: ProviderOptions["tools"],
): Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: boolean }> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
}

function collectResponseToolCalls(output: ResponseOutputItem[]): ProviderResponse["toolCalls"] {
  return output.flatMap((item) => {
    const toolCall = extractResponseToolCall(item);
    if (!toolCall) {
      return [];
    }

    return [{
      id: toolCall.id,
      name: toolCall.name,
      input: safeParseJson(toolCall.arguments),
    }];
  });
}

function extractResponseToolCall(item: ResponseOutputItem): { id: string; name: string; arguments: string } | null {
  if (item.type !== "function_call") {
    return null;
  }

  const rawId = item.call_id || item.id;
  const id = normalizeResponsesToolCallId(rawId, item.id || item.name || "response-tool");
  if (!id) {
    return null;
  }

  return {
    id,
    name: item.name,
    arguments: item.arguments,
  };
}

function mapResponsesStopReason(response: {
  output: ResponseOutputItem[];
  incomplete_details: { reason?: string | null } | null;
}): ProviderResponse["stopReason"] {
  if (response.output.some((item) => item.type === "function_call")) {
    return "tool_use";
  }

  if (response.incomplete_details?.reason === "max_output_tokens") {
    return "max_tokens";
  }

  return "end_turn";
}

function looksLikeJson(value: string): boolean {
  return (value.startsWith("{") && value.endsWith("}"))
    || (value.startsWith("[") && value.endsWith("]"))
    || (value.startsWith("\"") && value.endsWith("\""));
}

function hasUsableToolCallName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value !== "unknown"
    && value !== "undefined";
}

function normalizeResponsesToolCallId(value: unknown, fallbackSeed: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(trimmed)) {
      return trimmed;
    }
  }

  const seed = typeof value === "string" && value.trim().length > 0
    ? value
    : fallbackSeed;
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `call_${digest}`;
}
