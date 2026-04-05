import { Bot } from "grammy";
import type { TelegramBot, TelegramContext } from "./types.js";

export interface TelegramRouter {
  handleMessage(ctx: TelegramContext): Promise<void> | void;
  handleCallbackQuery(ctx: TelegramContext): Promise<void> | void;
}

export function createTelegramBot(token: string): TelegramBot {
  const bot = new Bot(token);

  return bot;
}

export function wireTelegramBot(bot: TelegramBot, router: TelegramRouter): TelegramBot {

  bot.on("message:text", async (ctx) => {
    await router.handleMessage(ctx);
  });

  bot.on("callback_query:data", async (ctx) => {
    await router.handleCallbackQuery(ctx);
  });

  return bot;
}
