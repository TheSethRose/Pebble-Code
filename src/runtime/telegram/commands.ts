import type { CommandRegistry } from "../../commands/registry.js";
import type { TelegramBot, TelegramSyncCommand } from "./types.js";

const TELEGRAM_SHARED_COMMANDS = [
  "help",
  "model",
  "provider",
  "compact",
  "memory",
  "review",
  "permissions",
  "plan",
] as const;

const TELEGRAM_TRANSPORT_COMMANDS: TelegramSyncCommand[] = [
  { command: "start", description: "Show Pebble Telegram status" },
  { command: "new", description: "Start a new session for this chat" },
  { command: "sessions", description: "List recent sessions for this chat" },
  { command: "resume", description: "Resume a prior chat session" },
  { command: "status", description: "Show Telegram runtime status" },
  { command: "approve", description: "Approve a pending tool action" },
  { command: "deny", description: "Deny a pending tool action" },
  { command: "stop", description: "Stop the current run" },
];

export function listTelegramNativeCommands(registry: CommandRegistry): TelegramSyncCommand[] {
  const shared = TELEGRAM_SHARED_COMMANDS.flatMap((name) => {
    const command = registry.find(name);
    if (!command) {
      return [];
    }

    return [{ command: name, description: command.description } satisfies TelegramSyncCommand];
  });

  return [...TELEGRAM_TRANSPORT_COMMANDS, ...shared];
}

export async function syncTelegramNativeCommands(bot: TelegramBot, registry: CommandRegistry): Promise<void> {
  await bot.api.setMyCommands(listTelegramNativeCommands(registry));
}

export function normalizeTelegramCommandText(text: string, botUsername?: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return trimmed;
  }

  const [commandPart, ...rest] = trimmed.split(/\s+/u);
  if (!commandPart) {
    return null;
  }

  const [name, mentionedBot] = commandPart.slice(1).split("@", 2);
  if (!name) {
    return null;
  }

  if (mentionedBot && botUsername && mentionedBot.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }

  return `/${name}${rest.length > 0 ? ` ${rest.join(" ")}` : ""}`;
}
