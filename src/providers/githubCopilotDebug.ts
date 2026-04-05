import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;
const SENSITIVE_KEY_PATTERN = /(token|authorization|api[_-]?key|credential|secret)/i;

type DebugValue =
  | string
  | number
  | boolean
  | null
  | DebugValue[]
  | { [key: string]: DebugValue };

function getPebbleHomeDir(): string {
  const configuredHome = process.env.PEBBLE_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : join(homedir(), ".pebble");
}

export function getGitHubCopilotDebugLogPath(): string {
  return join(getPebbleHomeDir(), "logs", "github-copilot-auth.log");
}

function applySecurePermissions(path: string, mode: number): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort only.
  }
}

function maskSensitiveString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const authMatch = trimmed.match(/^(Bearer|token)\s+(.+)$/i);
  if (authMatch) {
    return `${authMatch[1]} ${maskSensitiveString(authMatch[2] ?? "")}`;
  }

  if (trimmed.length <= 8) {
    return `${"*".repeat(trimmed.length)} (len=${trimmed.length})`;
  }

  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (len=${trimmed.length})`;
}

function sanitizeDebugValue(key: string, value: unknown): DebugValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return SENSITIVE_KEY_PATTERN.test(key) ? maskSensitiveString(value) : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugValue(key, item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeDebugValue(childKey, childValue),
      ]),
    );
  }

  return String(value);
}

function ensureDebugLogDir(logPath: string): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: LOG_DIR_MODE });
  }
  applySecurePermissions(dir, LOG_DIR_MODE);
}

export function logGitHubCopilotDebug(event: string, details: Record<string, unknown> = {}): void {
  try {
    const logPath = getGitHubCopilotDebugLogPath();
    ensureDebugLogDir(logPath);

    const payload = {
      timestamp: new Date().toISOString(),
      event,
      details: sanitizeDebugValue("details", details),
    };

    appendFileSync(logPath, `${JSON.stringify(payload)}\n`, {
      encoding: "utf-8",
      mode: LOG_FILE_MODE,
    });
    applySecurePermissions(logPath, LOG_FILE_MODE);
  } catch {
    // Logging must never break provider execution.
  }
}
