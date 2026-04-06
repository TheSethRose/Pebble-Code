import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TelegramLogger {
  readonly logPath: string;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function getTelegramLogPath(configDir: string): string {
  return join(configDir, "telegram.log");
}

export function createTelegramLogger(configDir: string): TelegramLogger {
  const logPath = getTelegramLogPath(configDir);

  ensureLogDir(logPath);

  return {
    logPath,
    info(message, context) {
      writeLogLine(logPath, "INFO", message, context);
    },
    warn(message, context) {
      writeLogLine(logPath, "WARN", message, context);
    },
    error(message, context) {
      writeLogLine(logPath, "ERROR", message, context);
    },
  };
}

function ensureLogDir(logPath: string): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeLogLine(
  logPath: string,
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  context?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const suffix = context && Object.keys(context).length > 0
    ? ` ${JSON.stringify(context)}`
    : "";

  appendFileSync(logPath, `[${timestamp}] ${level} ${message}${suffix}\n`, "utf-8");
}