import type { InlineKeyboard } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { TelegramBot, TelegramPromptScope, ResolvedTelegramRuntimeConfig } from "./types.js";
import { TELEGRAM_DEFAULT_PLACEHOLDER } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getTelegramRetryAfterMs(error: unknown): number | undefined {
  const value = error as {
    parameters?: { retry_after?: unknown };
    response?: { parameters?: { retry_after?: unknown } };
  } | undefined;

  const retryAfterSeconds = typeof value?.parameters?.retry_after === "number"
    ? value.parameters.retry_after
    : typeof value?.response?.parameters?.retry_after === "number"
      ? value.response.parameters.retry_after
      : undefined;

  return typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? retryAfterSeconds * 1_000
    : undefined;
}

function isTelegramMessageNotModifiedError(error: unknown): boolean {
  const candidate = error as {
    description?: unknown;
    message?: unknown;
    response?: { description?: unknown };
  } | undefined;

  const description = typeof candidate?.description === "string"
    ? candidate.description
    : typeof candidate?.response?.description === "string"
      ? candidate.response.description
      : typeof candidate?.message === "string"
        ? candidate.message
        : "";

  return description.toLowerCase().includes("message is not modified");
}

async function withTelegramRetry<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
  let attempts = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retryAfterMs = getTelegramRetryAfterMs(error);
      if (retryAfterMs === undefined || attempts >= retries) {
        throw error;
      }

      attempts += 1;
      await sleep(retryAfterMs);
    }
  }
}

function buildThreadOptions(threadId?: number): { message_thread_id?: number } {
  return typeof threadId === "number" ? { message_thread_id: threadId } : {};
}

function buildLinkPreviewOptions() {
  return {
    link_preview_options: { is_disabled: true },
  };
}

export function chunkTelegramText(text: string, maxChars: number): string[] {
  if (!text) {
    return [""];
  }

  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars);
    const breakAt = Math.max(
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf("\n"),
      slice.lastIndexOf(" "),
    );
    const nextIndex = breakAt > Math.floor(maxChars * 0.6) ? breakAt : maxChars;
    const nextChunk = remaining.slice(0, nextIndex).trimEnd();
    chunks.push(nextChunk);
    remaining = remaining.slice(nextIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export class TelegramDelivery {
  constructor(
    private readonly bot: TelegramBot,
    private readonly config: ResolvedTelegramRuntimeConfig,
  ) {}

  async sendText(
    scope: TelegramPromptScope,
    text: string,
    options: {
      replyMarkup?: InlineKeyboardMarkup | InlineKeyboard;
      forceReply?: boolean;
    } = {},
  ): Promise<number | undefined> {
    const chunks = chunkTelegramText(text, this.config.maxMessageChars);
    let lastMessageId: number | undefined;

    for (const chunk of chunks) {
      const sent = await withTelegramRetry(() => this.bot.api.sendMessage(scope.chatId, chunk || "…", {
        ...buildThreadOptions(scope.threadId),
        ...buildLinkPreviewOptions(),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        ...(options.forceReply
          ? { reply_markup: { force_reply: true, selective: true } }
          : {}),
      }));
      lastMessageId = sent.message_id;
    }

    return lastMessageId;
  }

  async updateReplyMarkup(
    scope: TelegramPromptScope,
    messageId: number,
    replyMarkup?: InlineKeyboardMarkup | InlineKeyboard,
  ): Promise<void> {
    try {
      await withTelegramRetry(() => this.bot.api.editMessageReplyMarkup(scope.chatId, messageId, {
        ...buildThreadOptions(scope.threadId),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }));
    } catch (error) {
      if (!isTelegramMessageNotModifiedError(error)) {
        throw error;
      }
    }
  }

  createLiveReply(scope: TelegramPromptScope): TelegramLiveReply {
    return new TelegramLiveReply(this.bot, this.config, scope);
  }
}

export class TelegramLiveReply {
  private placeholderMessageId: number | undefined;
  private buffer = "";
  private lastFlushedText = "";
  private typingInterval: ReturnType<typeof setInterval> | undefined;
  private lastFlushAt = 0;

  constructor(
    private readonly bot: TelegramBot,
    private readonly config: ResolvedTelegramRuntimeConfig,
    private readonly scope: TelegramPromptScope,
  ) {}

  async start(placeholder = TELEGRAM_DEFAULT_PLACEHOLDER): Promise<number | undefined> {
    const sent = await withTelegramRetry(() => this.bot.api.sendMessage(this.scope.chatId, placeholder, {
      ...buildThreadOptions(this.scope.threadId),
      ...buildLinkPreviewOptions(),
    }));
    this.placeholderMessageId = sent.message_id;
    this.startTyping();
    return this.placeholderMessageId;
  }

  async append(delta: string): Promise<void> {
    this.buffer += delta;
    if (!this.config.streamEdits) {
      return;
    }

    const now = Date.now();
    if (now - this.lastFlushAt < this.config.editDebounceMs) {
      return;
    }

    await this.flush();
  }

  async note(text: string): Promise<void> {
    await withTelegramRetry(() => this.bot.api.sendMessage(this.scope.chatId, text, {
      ...buildThreadOptions(this.scope.threadId),
      ...buildLinkPreviewOptions(),
    }));
  }

  async finalize(
    text = this.buffer,
    options: { replyMarkup?: InlineKeyboardMarkup | InlineKeyboard } = {},
  ): Promise<number | undefined> {
    this.stopTyping();
    const chunks = chunkTelegramText(text || "Done.", this.config.maxMessageChars);
    const firstChunk = chunks.shift() ?? "Done.";

    if (this.placeholderMessageId !== undefined) {
      try {
        await withTelegramRetry(() => this.bot.api.editMessageText(this.scope.chatId, this.placeholderMessageId!, firstChunk, {
          ...buildThreadOptions(this.scope.threadId),
          ...buildLinkPreviewOptions(),
          ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        }));
      } catch (error) {
        if (!isTelegramMessageNotModifiedError(error)) {
          throw error;
        }
      }
    } else {
      const sent = await withTelegramRetry(() => this.bot.api.sendMessage(this.scope.chatId, firstChunk, {
        ...buildThreadOptions(this.scope.threadId),
        ...buildLinkPreviewOptions(),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }));
      this.placeholderMessageId = sent.message_id;
    }

    for (const chunk of chunks) {
      const sent = await withTelegramRetry(() => this.bot.api.sendMessage(this.scope.chatId, chunk, {
        ...buildThreadOptions(this.scope.threadId),
        ...buildLinkPreviewOptions(),
      }));
      this.placeholderMessageId = sent.message_id;
    }

    this.lastFlushedText = text;
    return this.placeholderMessageId;
  }

  async fail(text: string): Promise<number | undefined> {
    return this.finalize(text);
  }

  private async flush(): Promise<void> {
    if (!this.buffer || this.buffer === this.lastFlushedText || this.placeholderMessageId === undefined) {
      return;
    }

    const nextText = chunkTelegramText(this.buffer, this.config.maxMessageChars)[0] ?? this.buffer;
    if (nextText === this.lastFlushedText) {
      return;
    }

    try {
      await withTelegramRetry(() => this.bot.api.editMessageText(this.scope.chatId, this.placeholderMessageId!, nextText, {
        ...buildThreadOptions(this.scope.threadId),
        ...buildLinkPreviewOptions(),
      }));
    } catch (error) {
      if (!isTelegramMessageNotModifiedError(error)) {
        throw error;
      }
    }
    this.lastFlushAt = Date.now();
    this.lastFlushedText = nextText;
  }

  private startTyping(): void {
    const sendTyping = () => {
      void withTelegramRetry(
        () => this.bot.api.sendChatAction(this.scope.chatId, "typing", buildThreadOptions(this.scope.threadId)),
        1,
      ).catch(() => {});
    };

    sendTyping();
    this.typingInterval = setInterval(sendTyping, 4_000);
    this.typingInterval.unref?.();
  }

  private stopTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = undefined;
    }
  }
}
