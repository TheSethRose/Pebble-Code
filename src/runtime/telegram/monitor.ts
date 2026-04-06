import { createServer } from "node:http";
import { once } from "node:events";
import type { Update } from "grammy/types";
import type { TelegramBot, ResolvedTelegramRuntimeConfig } from "./types.js";
import { TELEGRAM_ALLOWED_UPDATES } from "./types.js";
import { TelegramStateStore } from "./state.js";

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(() => {});
  }

  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function pollTelegramUpdatesOnce(params: {
  bot: TelegramBot;
  state: TelegramStateStore;
  pollingTimeoutSeconds: number;
  persistOffsets: boolean;
}): Promise<number | null> {
  const lastUpdateId = params.state.getLastUpdateId();
  const updates = await params.bot.api.getUpdates({
    ...(typeof lastUpdateId === "number" ? { offset: lastUpdateId + 1 } : {}),
    timeout: params.pollingTimeoutSeconds,
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
  });

  let highestUpdateId: number | null = null;
  for (const update of updates) {
    await params.bot.handleUpdate(update);
    highestUpdateId = update.update_id;
    if (params.persistOffsets) {
      params.state.setLastUpdateId(update.update_id);
    }
  }

  return highestUpdateId;
}

export async function runTelegramMonitor(params: {
  bot: TelegramBot;
  config: ResolvedTelegramRuntimeConfig;
  state: TelegramStateStore;
  signal?: AbortSignal;
  log?: (message: string, context?: Record<string, unknown>) => void;
}): Promise<void> {
  if (params.config.mode === "webhook") {
    await runTelegramWebhookServer(params);
    return;
  }

  await params.bot.api.deleteWebhook({ drop_pending_updates: false });
  params.log?.("Telegram polling started", {
    pollingTimeoutSeconds: params.config.pollingTimeoutSeconds,
    persistOffsets: params.config.persistOffsets,
    lastUpdateId: params.state.getLastUpdateId(),
  });
  let backoffMs = 1_000;

  while (!params.signal?.aborted) {
    try {
      const highestUpdateId = await pollTelegramUpdatesOnce({
        bot: params.bot,
        state: params.state,
        pollingTimeoutSeconds: params.config.pollingTimeoutSeconds,
        persistOffsets: params.config.persistOffsets,
      });
      if (highestUpdateId !== null) {
        params.log?.("Telegram updates processed", {
          highestUpdateId,
        });
      }
      backoffMs = 1_000;
    } catch (error) {
      params.log?.("Telegram polling error", {
        error: error instanceof Error ? error.message : String(error),
        backoffMs,
      });
      if (params.signal?.aborted) {
        break;
      }
      await Bun.sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 15_000);
    }
  }
}

async function runTelegramWebhookServer(params: {
  bot: TelegramBot;
  config: ResolvedTelegramRuntimeConfig;
  state: TelegramStateStore;
  signal?: AbortSignal;
  log?: (message: string, context?: Record<string, unknown>) => void;
}): Promise<void> {
  const path = params.config.webhookPath;
  const secret = params.config.webhookSecret;

  if (!params.config.webhookUrl) {
    throw new Error("Telegram webhook mode requires telegram.webhookUrl or --webhook-url.");
  }

  await params.bot.api.setWebhook(params.config.webhookUrl, {
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    ...(secret ? { secret_token: secret } : {}),
  });

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== path) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    if (secret && request.headers["x-telegram-bot-api-secret-token"] !== secret) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    try {
      const raw = Buffer.concat(chunks).toString("utf-8");
      const update = JSON.parse(raw) as Update;
      await params.bot.handleUpdate(update);
      if (params.config.persistOffsets && typeof update.update_id === "number") {
        params.state.setLastUpdateId(update.update_id);
      }
      params.log?.("Telegram webhook update processed", {
        updateId: typeof update.update_id === "number" ? update.update_id : undefined,
      });
      response.statusCode = 200;
      response.end("ok");
    } catch (error) {
      params.log?.("Telegram webhook error", {
        error: error instanceof Error ? error.message : String(error),
      });
      response.statusCode = 500;
      response.end("error");
    }
  });

  server.listen(params.config.webhookPort, params.config.webhookHost);
  await once(server, "listening");
  params.log?.("Telegram webhook listening", {
    url: `http://${params.config.webhookHost}:${params.config.webhookPort}${path}`,
  });

  try {
    await waitForAbort(params.signal);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
