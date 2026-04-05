#!/usr/bin/env bun

import { runTelegram } from "../runtime/telegram/index.js";

const args = process.argv.slice(2);
const abortController = new AbortController();

process.on("SIGINT", () => abortController.abort());
process.on("SIGTERM", () => abortController.abort());

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const options = {
  cwd: getFlagValue(args, "--cwd") ?? process.cwd(),
  botToken: getFlagValue(args, "--bot-token"),
  botId: getFlagValue(args, "--bot-id"),
  botUsername: getFlagValue(args, "--bot-username"),
  mode: normalizeMode(getFlagValue(args, "--mode")),
  allowedUserIds: getRepeatedFlagValues(args, "--allowed-user-id"),
  allowedChatIds: getRepeatedFlagValues(args, "--allowed-chat-id"),
  webhookUrl: getFlagValue(args, "--webhook-url"),
  webhookHost: getFlagValue(args, "--webhook-host"),
  webhookPath: getFlagValue(args, "--webhook-path"),
  webhookSecret: getFlagValue(args, "--webhook-secret"),
  webhookPort: normalizeNumber(getFlagValue(args, "--webhook-port")),
  signal: abortController.signal,
};

runTelegram(options).then((exitCode) => {
  process.exit(exitCode);
}).catch((error) => {
  console.error(`Fatal telegram runtime error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function getRepeatedFlagValues(args: string[], flag: string): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1]?.trim();
      if (value) {
        values.push(value);
      }
    }
  }

  return values.length > 0 ? values : undefined;
}

function normalizeMode(value: string | undefined): "polling" | "webhook" | undefined {
  if (value === "polling" || value === "webhook") {
    return value;
  }

  return undefined;
}

function normalizeNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printHelp() {
  console.log(`Pebble Telegram runtime

Usage:
  bun run src/entrypoints/telegram.ts [options]

Options:
  --cwd <path>                Working directory / project root
  --bot-token <token>         Override telegram bot token
  --bot-id <id>               Expected Telegram bot id
  --bot-username <name>       Expected Telegram bot username
  --mode <polling|webhook>    Telegram transport mode
  --allowed-user-id <id>      Allow a Telegram user id (repeatable)
  --allowed-chat-id <id>      Allow a Telegram chat id (repeatable)
  --webhook-url <url>         Public webhook URL for webhook mode
  --webhook-host <host>       Local webhook bind host
  --webhook-port <port>       Local webhook bind port
  --webhook-path <path>       Local webhook route path
  --webhook-secret <secret>   Telegram webhook secret token
  --help, -h                  Show this help
`);
}
