import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
} from "../constants/openrouter.js";
import {
  applyProviderDefaults,
  getBuiltinProviderDefinition,
  normalizeProviderId,
} from "../providers/catalog.js";
import {
  DEFAULT_VOICE_BASE_URL,
  DEFAULT_VOICE_MODEL,
  DEFAULT_VOICE_PROVIDER,
  DEFAULT_VOICE_TRANSCRIBE_PATH,
  normalizeVoiceBaseUrlValue,
  normalizeVoicePathValue,
  normalizeVoiceProviderValue,
} from "../voice/config.js";
import type { McpServerConfig } from "../extensions/contracts.js";
import { buildTrustConfig } from "./trust";
import type { TrustConfig, PermissionMode } from "./permissions";
import { loadRepositoryInstructions, type InstructionFile } from "./instructions";

export interface ProviderOAuthSession {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  baseUrl?: string;
  tokenType?: string;
  metadata?: Record<string, string>;
}

export interface ProviderCredentialSettings {
  credential?: string;
  oauth?: ProviderOAuthSession;
}

export type ProviderCredentialMap = Record<string, ProviderCredentialSettings>;
export type ShellCompactionMode = "off" | "auto" | "aggressive";
export type WorktreeStartupMode = "manual" | "resume-linked";
export type TelegramRunMode = "polling" | "webhook";
export const DEFAULT_COMPACT_PREPARE_RATIO = 0.8;

export interface TelegramSettings {
  enabled?: boolean;
  botToken?: string;
  botId?: string;
  botUsername?: string;
  mode?: TelegramRunMode;
  pollingTimeoutSeconds?: number;
  allowedUserIds?: string[];
  allowedChatIds?: string[];
  handleGroupMentionsOnly?: boolean;
  streamEdits?: boolean;
  editDebounceMs?: number;
  maxMessageChars?: number;
  syncCommandsOnStart?: boolean;
  persistOffsets?: boolean;
  webhookUrl?: string;
  webhookPath?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookSecret?: string;
}

/**
 * Global settings loaded from config files.
 */
export interface Settings {
  permissionMode: PermissionMode;
  model?: string;
  provider?: string;
  apiKey?: string;
  providerAuth?: ProviderCredentialMap;
  baseUrl?: string;
  mcpServers?: McpServerConfig[];
  maxTurns?: number;
  telemetryEnabled: boolean;
  compactThreshold?: number;
  compactPrepareThreshold?: number;
  compactionInstructions?: string;
  shellCompactionMode?: ShellCompactionMode;
  providerCompactionMarkers?: boolean;
  worktreeStartupMode?: WorktreeStartupMode;
  telegram?: TelegramSettings;
  fullscreenRenderer?: boolean;
  voiceEnabled?: boolean;
  voiceProvider?: string;
  voiceBaseUrl?: string;
  voiceTranscribePath?: string;
  voiceModel?: string;
}

const DEFAULT_SETTINGS: Settings = {
  permissionMode: "always-ask",
  provider: OPENROUTER_PROVIDER_ID,
  telemetryEnabled: false,
  maxTurns: 50,
  shellCompactionMode: "auto",
  providerCompactionMarkers: false,
  worktreeStartupMode: "manual",
  telegram: {
    enabled: false,
    mode: "polling",
    pollingTimeoutSeconds: 20,
    handleGroupMentionsOnly: true,
    streamEdits: true,
    editDebounceMs: 750,
    maxMessageChars: 4000,
    syncCommandsOnStart: true,
    persistOffsets: true,
    webhookPath: "/telegram/webhook",
    webhookHost: "127.0.0.1",
    webhookPort: 8788,
  },
  fullscreenRenderer: true,
  voiceEnabled: false,
  voiceProvider: DEFAULT_VOICE_PROVIDER,
  voiceBaseUrl: DEFAULT_VOICE_BASE_URL,
  voiceTranscribePath: DEFAULT_VOICE_TRANSCRIBE_PATH,
  voiceModel: DEFAULT_VOICE_MODEL,
};

const CONFIG_DIR_MODE = 0o700;
const SETTINGS_FILE_MODE = 0o600;
const USER_SETTINGS_FILE_NAME = "settings.json";
const PROJECT_SETTINGS_FILE_NAME = "project-settings.json";

type SettingsInput = Partial<Settings>;

function normalizeOptionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalIdString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return normalizeOptionalNonEmptyString(value);
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value.flatMap((entry) => {
      const item = normalizeOptionalIdString(entry);
      return item ? [item] : [];
    });
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  if (typeof value === "string") {
    const normalized = value
      .split(/[\s,]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  return undefined;
}

function normalizeTelegramMode(value: unknown): TelegramRunMode | undefined {
  return value === "webhook" ? "webhook" : value === "polling" ? "polling" : undefined;
}

function normalizeTelegramSettings(input: unknown): TelegramSettings | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const value = input as Record<string, unknown>;
  const enabled = normalizeOptionalBoolean(value.enabled);
  const botToken = normalizeOptionalNonEmptyString(value.botToken);
  const botId = normalizeOptionalIdString(value.botId);
  const botUsername = normalizeOptionalNonEmptyString(value.botUsername);
  const mode = normalizeTelegramMode(value.mode);
  const pollingTimeoutSeconds = normalizeOptionalPositiveNumber(value.pollingTimeoutSeconds);
  const allowedUserIds = normalizeStringList(value.allowedUserIds);
  const allowedChatIds = normalizeStringList(value.allowedChatIds);
  const handleGroupMentionsOnly = normalizeOptionalBoolean(value.handleGroupMentionsOnly);
  const streamEdits = normalizeOptionalBoolean(value.streamEdits);
  const editDebounceMs = normalizeOptionalPositiveNumber(value.editDebounceMs);
  const maxMessageChars = normalizeOptionalPositiveNumber(value.maxMessageChars);
  const syncCommandsOnStart = normalizeOptionalBoolean(value.syncCommandsOnStart);
  const persistOffsets = normalizeOptionalBoolean(value.persistOffsets);
  const webhookUrl = normalizeOptionalNonEmptyString(value.webhookUrl);
  const webhookPath = normalizeOptionalNonEmptyString(value.webhookPath);
  const webhookHost = normalizeOptionalNonEmptyString(value.webhookHost);
  const webhookPort = normalizeOptionalPositiveNumber(value.webhookPort);
  const webhookSecret = normalizeOptionalNonEmptyString(value.webhookSecret);

  const normalized: TelegramSettings = {
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(botToken ? { botToken } : {}),
    ...(botId ? { botId } : {}),
    ...(botUsername ? { botUsername } : {}),
    ...(mode ? { mode } : {}),
    ...(typeof pollingTimeoutSeconds === "number" ? { pollingTimeoutSeconds } : {}),
    ...(allowedUserIds ? { allowedUserIds } : {}),
    ...(allowedChatIds ? { allowedChatIds } : {}),
    ...(typeof handleGroupMentionsOnly === "boolean" ? { handleGroupMentionsOnly } : {}),
    ...(typeof streamEdits === "boolean" ? { streamEdits } : {}),
    ...(typeof editDebounceMs === "number" ? { editDebounceMs } : {}),
    ...(typeof maxMessageChars === "number" ? { maxMessageChars } : {}),
    ...(typeof syncCommandsOnStart === "boolean" ? { syncCommandsOnStart } : {}),
    ...(typeof persistOffsets === "boolean" ? { persistOffsets } : {}),
    ...(webhookUrl ? { webhookUrl } : {}),
    ...(webhookPath ? { webhookPath } : {}),
    ...(webhookHost ? { webhookHost } : {}),
    ...(typeof webhookPort === "number" ? { webhookPort } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function getEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeOptionalNonEmptyString(process.env[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getTelegramEnvOverrides(): TelegramSettings | undefined {
  return normalizeTelegramSettings({
    botToken: getEnvValue("PEBBLE_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"),
    botId: getEnvValue("PEBBLE_TELEGRAM_BOT_ID"),
    botUsername: getEnvValue("PEBBLE_TELEGRAM_BOT_USERNAME"),
    mode: getEnvValue("PEBBLE_TELEGRAM_MODE"),
    pollingTimeoutSeconds: getEnvValue("PEBBLE_TELEGRAM_POLLING_TIMEOUT_SECONDS"),
    allowedUserIds: getEnvValue("PEBBLE_TELEGRAM_ALLOWED_USER_IDS"),
    allowedChatIds: getEnvValue("PEBBLE_TELEGRAM_ALLOWED_CHAT_IDS"),
    handleGroupMentionsOnly: getEnvValue("PEBBLE_TELEGRAM_HANDLE_GROUP_MENTIONS_ONLY"),
    streamEdits: getEnvValue("PEBBLE_TELEGRAM_STREAM_EDITS"),
    editDebounceMs: getEnvValue("PEBBLE_TELEGRAM_EDIT_DEBOUNCE_MS"),
    maxMessageChars: getEnvValue("PEBBLE_TELEGRAM_MAX_MESSAGE_CHARS"),
    syncCommandsOnStart: getEnvValue("PEBBLE_TELEGRAM_SYNC_COMMANDS_ON_START"),
    persistOffsets: getEnvValue("PEBBLE_TELEGRAM_PERSIST_OFFSETS"),
    webhookUrl: getEnvValue("PEBBLE_TELEGRAM_WEBHOOK_URL"),
    webhookPath: getEnvValue("PEBBLE_TELEGRAM_WEBHOOK_PATH"),
    webhookHost: getEnvValue("PEBBLE_TELEGRAM_WEBHOOK_HOST"),
    webhookPort: getEnvValue("PEBBLE_TELEGRAM_WEBHOOK_PORT"),
    webhookSecret: getEnvValue("PEBBLE_TELEGRAM_WEBHOOK_SECRET"),
  });
}

function applyTelegramEnvOverrides(settings: Settings): Settings {
  const envOverrides = getTelegramEnvOverrides();
  if (!envOverrides) {
    return settings;
  }

  return {
    ...settings,
    telegram: {
      ...(settings.telegram ?? {}),
      ...envOverrides,
    },
  };
}

function stripTelegramEnvOverridesForPersistence(settings: Settings): Settings {
  const envOverrides = getTelegramEnvOverrides();
  if (!envOverrides || !settings.telegram) {
    return settings;
  }

  const sanitizedTelegram = { ...settings.telegram } as Record<string, unknown>;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (JSON.stringify(sanitizedTelegram[key]) === JSON.stringify(value)) {
      delete sanitizedTelegram[key];
    }
  }

  return {
    ...settings,
    telegram: Object.keys(sanitizedTelegram).length > 0
      ? sanitizedTelegram as TelegramSettings
      : undefined,
  };
}

function normalizeProviderOAuthSession(input: unknown): ProviderOAuthSession | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const value = input as {
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresAt?: unknown;
    accountId?: unknown;
    baseUrl?: unknown;
    tokenType?: unknown;
    metadata?: unknown;
  };

  const accessToken = typeof value.accessToken === "string" ? value.accessToken.trim() : "";
  const refreshToken = typeof value.refreshToken === "string" ? value.refreshToken.trim() : "";
  const accountId = typeof value.accountId === "string" ? value.accountId.trim() : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const tokenType = typeof value.tokenType === "string" ? value.tokenType.trim() : "";
  const expiresAt =
    typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
      ? value.expiresAt
      : typeof value.expiresAt === "string" && value.expiresAt.trim()
        ? Number(value.expiresAt)
        : undefined;
  const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
    ? Object.fromEntries(
        Object.entries(value.metadata).flatMap(([key, metadataValue]) => {
          if (typeof metadataValue === "string") {
            const trimmed = metadataValue.trim();
            return trimmed ? [[key, trimmed] as const] : [];
          }

          if (typeof metadataValue === "number" || typeof metadataValue === "boolean") {
            return [[key, String(metadataValue)] as const];
          }

          return [];
        }),
      )
    : undefined;

  const normalized: ProviderOAuthSession = {
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof expiresAt === "number" && Number.isFinite(expiresAt) ? { expiresAt } : {}),
    ...(accountId ? { accountId } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(tokenType ? { tokenType } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeProviderCredentialMap(input: unknown): ProviderCredentialMap | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(input).flatMap(([provider, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const credential = typeof (value as { credential?: unknown }).credential === "string"
      ? (value as { credential: string }).credential.trim()
      : "";
    const oauth = normalizeProviderOAuthSession((value as { oauth?: unknown }).oauth);

    if (!credential && !oauth) {
      return [];
    }

    return [[normalizeProviderId(provider), {
      ...(credential ? { credential } : {}),
      ...(oauth ? { oauth } : {}),
    }] as const];
  });

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeSettingsInput(settings: SettingsInput): SettingsInput {
  const normalizedProviderAuth = normalizeProviderCredentialMap(settings.providerAuth);
  const legacyApiKey = typeof settings.apiKey === "string" ? settings.apiKey.trim() : "";
  const normalizedProvider = normalizeProviderId(settings.provider);
  const providerDefinition = getBuiltinProviderDefinition(normalizedProvider);
  const normalizedCompactThreshold = normalizeOptionalPositiveNumber(settings.compactThreshold);
  const normalizedCompactPrepareThreshold = normalizeOptionalPositiveNumber(settings.compactPrepareThreshold);
  const normalizedCompactionInstructions = typeof settings.compactionInstructions === "string"
    ? settings.compactionInstructions.trim()
    : "";
  const normalizedProviderCompactionMarkers = typeof settings.providerCompactionMarkers === "boolean"
    ? settings.providerCompactionMarkers
    : undefined;
  const normalizedVoiceEnabled = typeof settings.voiceEnabled === "boolean"
    ? settings.voiceEnabled
    : undefined;
  const normalizedWorktreeStartupMode = settings.worktreeStartupMode === "resume-linked"
    ? "resume-linked"
    : settings.worktreeStartupMode === "manual"
      ? "manual"
      : undefined;
  const normalizedTelegram = normalizeTelegramSettings(settings.telegram);
  const normalizedVoiceProvider = normalizeVoiceProviderValue(settings.voiceProvider);
  const normalizedVoiceBaseUrl = normalizeVoiceBaseUrlValue(settings.voiceBaseUrl);
  const normalizedVoiceTranscribePath = normalizeVoicePathValue(settings.voiceTranscribePath);
  const normalizedVoiceModel = normalizeVoiceProviderValue(settings.voiceModel);

  if (!legacyApiKey || providerDefinition?.authKind === "oauth") {
    return {
      ...settings,
      ...(typeof normalizedCompactThreshold === "number" ? { compactThreshold: normalizedCompactThreshold } : {}),
      ...(typeof normalizedCompactPrepareThreshold === "number"
        ? { compactPrepareThreshold: normalizedCompactPrepareThreshold }
        : {}),
      ...(normalizedCompactionInstructions ? { compactionInstructions: normalizedCompactionInstructions } : {}),
      ...(typeof normalizedProviderCompactionMarkers === "boolean"
        ? { providerCompactionMarkers: normalizedProviderCompactionMarkers }
        : {}),
      ...(normalizedWorktreeStartupMode ? { worktreeStartupMode: normalizedWorktreeStartupMode } : {}),
      ...(normalizedTelegram ? { telegram: normalizedTelegram } : {}),
      ...(typeof normalizedVoiceEnabled === "boolean" ? { voiceEnabled: normalizedVoiceEnabled } : {}),
      ...(normalizedVoiceProvider ? { voiceProvider: normalizedVoiceProvider } : {}),
      ...(normalizedVoiceBaseUrl ? { voiceBaseUrl: normalizedVoiceBaseUrl } : {}),
      ...(normalizedVoiceTranscribePath ? { voiceTranscribePath: normalizedVoiceTranscribePath } : {}),
      ...(normalizedVoiceModel ? { voiceModel: normalizedVoiceModel } : {}),
      providerAuth: normalizedProviderAuth,
    };
  }

  return {
    ...settings,
    ...(typeof normalizedCompactThreshold === "number" ? { compactThreshold: normalizedCompactThreshold } : {}),
    ...(typeof normalizedCompactPrepareThreshold === "number"
      ? { compactPrepareThreshold: normalizedCompactPrepareThreshold }
      : {}),
    ...(normalizedCompactionInstructions ? { compactionInstructions: normalizedCompactionInstructions } : {}),
    ...(typeof normalizedProviderCompactionMarkers === "boolean"
      ? { providerCompactionMarkers: normalizedProviderCompactionMarkers }
      : {}),
    ...(normalizedWorktreeStartupMode ? { worktreeStartupMode: normalizedWorktreeStartupMode } : {}),
    ...(normalizedTelegram ? { telegram: normalizedTelegram } : {}),
    ...(typeof normalizedVoiceEnabled === "boolean" ? { voiceEnabled: normalizedVoiceEnabled } : {}),
    ...(normalizedVoiceProvider ? { voiceProvider: normalizedVoiceProvider } : {}),
    ...(normalizedVoiceBaseUrl ? { voiceBaseUrl: normalizedVoiceBaseUrl } : {}),
    ...(normalizedVoiceTranscribePath ? { voiceTranscribePath: normalizedVoiceTranscribePath } : {}),
    ...(normalizedVoiceModel ? { voiceModel: normalizedVoiceModel } : {}),
    providerAuth: {
      ...(normalizedProviderAuth ?? {}),
      [normalizedProvider]: {
        credential: normalizedProviderAuth?.[normalizedProvider]?.credential ?? legacyApiKey,
      },
    },
  };
}

export function getStoredProviderCredential(
  settings: Partial<Settings> = {},
  provider?: string,
): string | undefined {
  const normalizedProvider = normalizeProviderId(provider ?? settings.provider);
  const storedCredential = settings.providerAuth?.[normalizedProvider]?.credential?.trim();
  if (storedCredential) {
    return storedCredential;
  }

  if (normalizeProviderId(settings.provider) === normalizedProvider) {
    return settings.apiKey?.trim() || undefined;
  }

  return undefined;
}

export function getStoredProviderAuthToken(
  settings: Partial<Settings> = {},
  provider?: string,
): string | undefined {
  const normalizedProvider = normalizeProviderId(provider ?? settings.provider);
  const providerDefinition = getBuiltinProviderDefinition(normalizedProvider);
  const storedCredential = getStoredProviderCredential(settings, normalizedProvider);
  const oauthSession = getStoredProviderOAuthSession(settings, normalizedProvider);
  const oauthToken = oauthSession?.accessToken?.trim() || oauthSession?.refreshToken?.trim() || undefined;

  if (providerDefinition?.authKind === "oauth") {
    return oauthToken || storedCredential;
  }

  return storedCredential || oauthToken;
}

export function getStoredProviderOAuthSession(
  settings: Partial<Settings> = {},
  provider?: string,
): ProviderOAuthSession | undefined {
  const normalizedProvider = normalizeProviderId(provider ?? settings.provider);
  return normalizeProviderOAuthSession(settings.providerAuth?.[normalizedProvider]?.oauth);
}

export function setStoredProviderCredential(
  settings: Settings,
  provider: string,
  credential: string,
): Settings {
  const normalizedProvider = normalizeProviderId(provider);
  const trimmedCredential = credential.trim();
  const nextProviderAuth = { ...(settings.providerAuth ?? {}) };

  if (trimmedCredential) {
    nextProviderAuth[normalizedProvider] = {
      ...(nextProviderAuth[normalizedProvider]?.oauth
        ? { oauth: nextProviderAuth[normalizedProvider]?.oauth }
        : {}),
      credential: trimmedCredential,
    };
  } else {
    const existingOauth = nextProviderAuth[normalizedProvider]?.oauth;
    if (existingOauth) {
      nextProviderAuth[normalizedProvider] = { oauth: existingOauth };
    } else {
      delete nextProviderAuth[normalizedProvider];
    }
  }

  const activeProvider = normalizeProviderId(settings.provider);
  return {
    ...settings,
    providerAuth: Object.keys(nextProviderAuth).length > 0 ? nextProviderAuth : undefined,
    apiKey: activeProvider === normalizedProvider ? trimmedCredential || undefined : settings.apiKey,
  };
}

export function setStoredProviderOAuthSession(
  settings: Settings,
  provider: string,
  oauth: ProviderOAuthSession | undefined,
): Settings {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedOauth = normalizeProviderOAuthSession(oauth);
  const nextProviderAuth = { ...(settings.providerAuth ?? {}) };
  const existingCredential = nextProviderAuth[normalizedProvider]?.credential?.trim();

  if (normalizedOauth) {
    nextProviderAuth[normalizedProvider] = {
      ...(existingCredential ? { credential: existingCredential } : {}),
      oauth: normalizedOauth,
    };
  } else if (existingCredential) {
    nextProviderAuth[normalizedProvider] = { credential: existingCredential };
  } else {
    delete nextProviderAuth[normalizedProvider];
  }

  return {
    ...settings,
    providerAuth: Object.keys(nextProviderAuth).length > 0 ? nextProviderAuth : undefined,
  };
}

export function clearStoredProviderAuth(
  settings: Settings,
  provider: string,
): Settings {
  const normalizedProvider = normalizeProviderId(provider);
  const nextProviderAuth = { ...(settings.providerAuth ?? {}) };
  delete nextProviderAuth[normalizedProvider];

  return synchronizeActiveProviderCredential({
    ...settings,
    providerAuth: Object.keys(nextProviderAuth).length > 0 ? nextProviderAuth : undefined,
  });
}

function synchronizeActiveProviderCredential(settings: Settings): Settings {
  return {
    ...settings,
    apiKey: getStoredProviderAuthToken(settings, settings.provider),
  };
}

/**
 * Runtime configuration combining settings, trust, and instructions.
 */
export interface RuntimeConfig {
  settings: Settings;
  trust: TrustConfig;
  instructions: InstructionFile[];
  cwd: string;
}

/**
 * Load settings from a JSON file.
 */
function readSettingsFile(configPath: string): SettingsInput {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SettingsInput
      : {};
  } catch {
    return {};
  }
}

function mergeSettingsLayers(...layers: SettingsInput[]): Settings {
  return applyTelegramEnvOverrides(
    synchronizeActiveProviderCredential(applyProviderDefaults(
      layers.map((layer) => normalizeSettingsInput(layer)).reduce<Settings>(
        (merged, layer) => ({
          ...merged,
          ...layer,
          ...(merged.telegram || layer.telegram
            ? {
                telegram: {
                  ...(merged.telegram ?? {}),
                  ...(layer.telegram ?? {}),
                },
              }
            : {}),
        }),
        { ...DEFAULT_SETTINGS },
      ),
    )),
  );
}

export function loadSettings(configPath: string): Settings {
  return mergeSettingsLayers(readSettingsFile(configPath));
}

function getPebbleHomeDir(): string {
  const configuredHome = process.env.PEBBLE_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : join(homedir(), ".pebble");
}

function getProjectConfigDir(cwd: string): string {
  const trust = buildTrustConfig(cwd);
  return join(trust.projectRoot, ".pebble");
}

function getLegacySettingsPath(cwd: string): string {
  return join(getProjectConfigDir(cwd), USER_SETTINGS_FILE_NAME);
}

export function getProjectSettingsPath(cwd: string): string {
  return join(getProjectConfigDir(cwd), PROJECT_SETTINGS_FILE_NAME);
}

function applySecurePermissions(path: string, mode: number): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort hardening only.
  }
}

function removeLegacySettingsFile(cwd: string, settingsPath: string): void {
  const legacyPath = getLegacySettingsPath(cwd);
  if (legacyPath === settingsPath || !existsSync(legacyPath)) {
    return;
  }

  try {
    rmSync(legacyPath, { force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

export function getConfigDir(cwd: string): string {
  void cwd;
  return getPebbleHomeDir();
}

export function getSettingsPath(cwd: string): string {
  return join(getConfigDir(cwd), USER_SETTINGS_FILE_NAME);
}

function sanitizeProjectSettings(settings: SettingsInput): SettingsInput {
  const {
    apiKey: _ignoredApiKey,
    providerAuth: _ignoredProviderAuth,
    ...rest
  } = normalizeSettingsInput(settings);
  const telegram = normalizeTelegramSettings(rest.telegram);

  if (!telegram) {
    return rest;
  }

  const {
    botToken: _ignoredBotToken,
    webhookSecret: _ignoredWebhookSecret,
    ...safeTelegram
  } = telegram;

  return {
    ...rest,
    telegram: Object.keys(safeTelegram).length > 0 ? safeTelegram : undefined,
  };
}

function loadProjectSettingsForCwd(cwd: string): SettingsInput {
  return sanitizeProjectSettings(readSettingsFile(getProjectSettingsPath(cwd)));
}

function loadUserSettingsForCwd(cwd: string): SettingsInput {
  const settingsPath = getSettingsPath(cwd);
  if (existsSync(settingsPath)) {
    removeLegacySettingsFile(cwd, settingsPath);
    return readSettingsFile(settingsPath);
  }

  const legacyPath = getLegacySettingsPath(cwd);
  if (legacyPath !== settingsPath && existsSync(legacyPath)) {
    const migratedSettings = readSettingsFile(legacyPath);
    saveSettings(settingsPath, migratedSettings);
    removeLegacySettingsFile(cwd, settingsPath);
    return migratedSettings;
  }

  return {};
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return left === right;
  }

  if (typeof left === "object" || typeof right === "object") {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function buildUserSettingsPayload(cwd: string, settings: Settings): SettingsInput {
  const projectDefaults = mergeSettingsLayers(loadProjectSettingsForCwd(cwd));
  const normalizedSettings = synchronizeActiveProviderCredential(
    ensureSettingsProviderAuth(stripTelegramEnvOverridesForPersistence(settings)),
  );
  const entries = Object.entries(normalizedSettings) as Array<[keyof Settings, Settings[keyof Settings]]>;
  const payload: SettingsInput = {};

  for (const [key, value] of entries) {
    if (key === "apiKey") {
      continue;
    }

    if (value === undefined) {
      continue;
    }

    if (!settingsValuesEqual(value, projectDefaults[key])) {
      Object.assign(payload, { [key]: value });
    }
  }

  return payload;
}

function ensureSettingsProviderAuth(settings: Settings): Settings {
  const normalized = normalizeSettingsInput(settings) as Settings;
  return {
    ...settings,
    providerAuth: normalized.providerAuth,
  };
}

export function loadSettingsForCwd(cwd: string): Settings {
  return mergeSettingsLayers(
    loadProjectSettingsForCwd(cwd),
    loadUserSettingsForCwd(cwd),
  );
}

/**
 * Save settings to a JSON file.
 */
export function saveSettings(configPath: string, settings: SettingsInput): void {
  const normalizedSettings = normalizeSettingsInput(settings);
  const { apiKey: _ignoredApiKey, ...persistedSettings } = normalizedSettings;
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  applySecurePermissions(dir, CONFIG_DIR_MODE);
  writeFileSync(configPath, JSON.stringify(persistedSettings, null, 2), {
    encoding: "utf-8",
    mode: SETTINGS_FILE_MODE,
  });
  applySecurePermissions(configPath, SETTINGS_FILE_MODE);
}

export function saveSettingsForCwd(cwd: string, settings: Settings): string {
  const settingsPath = getSettingsPath(cwd);
  const userSettings = buildUserSettingsPayload(cwd, settings);

  if (Object.keys(userSettings).length === 0) {
    try {
      rmSync(settingsPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  } else {
    saveSettings(settingsPath, userSettings);
  }

  removeLegacySettingsFile(cwd, settingsPath);
  return settingsPath;
}

export function saveProjectSettingsForCwd(cwd: string, settings: SettingsInput): string {
  const projectSettingsPath = getProjectSettingsPath(cwd);
  const sanitized = sanitizeProjectSettings(settings);
  const dir = dirname(projectSettingsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(projectSettingsPath, JSON.stringify(sanitized, null, 2), "utf-8");
  return projectSettingsPath;
}

/**
 * Build the full runtime configuration.
 */
export function buildRuntimeConfig(cwd: string): RuntimeConfig {
  const trust = buildTrustConfig(cwd);
  const settings = loadSettingsForCwd(trust.projectRoot);
  const instructions =
    trust.instructionsLoaded
      ? loadRepositoryInstructions(trust.projectRoot)
      : [];

  return {
    settings,
    trust,
    instructions,
    cwd,
  };
}
