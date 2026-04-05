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
  shellCompactionMode?: ShellCompactionMode;
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
  const normalizedVoiceEnabled = typeof settings.voiceEnabled === "boolean"
    ? settings.voiceEnabled
    : undefined;
  const normalizedVoiceProvider = normalizeVoiceProviderValue(settings.voiceProvider);
  const normalizedVoiceBaseUrl = normalizeVoiceBaseUrlValue(settings.voiceBaseUrl);
  const normalizedVoiceTranscribePath = normalizeVoicePathValue(settings.voiceTranscribePath);
  const normalizedVoiceModel = normalizeVoiceProviderValue(settings.voiceModel);

  if (!legacyApiKey || providerDefinition?.authKind === "oauth") {
    return {
      ...settings,
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
  return synchronizeActiveProviderCredential(applyProviderDefaults(
    layers.map((layer) => normalizeSettingsInput(layer)).reduce<Settings>(
      (merged, layer) => ({ ...merged, ...layer }),
      { ...DEFAULT_SETTINGS },
    ),
  ));
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
  return rest;
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
    ensureSettingsProviderAuth(settings),
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
