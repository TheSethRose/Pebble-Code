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
import type { McpServerConfig } from "../extensions/contracts.js";
import { buildTrustConfig } from "./trust";
import type { TrustConfig, PermissionMode } from "./permissions";
import { loadRepositoryInstructions, type InstructionFile } from "./instructions";

/**
 * Global settings loaded from config files.
 */
export interface Settings {
  permissionMode: PermissionMode;
  model?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  mcpServers?: McpServerConfig[];
  maxTurns?: number;
  telemetryEnabled: boolean;
  compactThreshold?: number;
  fullscreenRenderer?: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  permissionMode: "always-ask",
  provider: OPENROUTER_PROVIDER_ID,
  model: OPENROUTER_DEFAULT_MODEL,
  baseUrl: OPENROUTER_DEFAULT_BASE_URL,
  telemetryEnabled: false,
  maxTurns: 50,
  fullscreenRenderer: true,
};

const CONFIG_DIR_MODE = 0o700;
const SETTINGS_FILE_MODE = 0o600;
const USER_SETTINGS_FILE_NAME = "settings.json";
const PROJECT_SETTINGS_FILE_NAME = "project-settings.json";

type SettingsInput = Partial<Settings>;

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
  return layers.reduce<Settings>(
    (merged, layer) => ({ ...merged, ...layer }),
    { ...DEFAULT_SETTINGS },
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
  const { apiKey: _ignoredApiKey, ...rest } = settings;
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
  const entries = Object.entries(settings) as Array<[keyof Settings, Settings[keyof Settings]]>;
  const payload: SettingsInput = {};

  for (const [key, value] of entries) {
    if (key === "apiKey") {
      if (typeof value === "string" && value.trim()) {
        payload.apiKey = value.trim();
      }
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
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  applySecurePermissions(dir, CONFIG_DIR_MODE);
  writeFileSync(configPath, JSON.stringify(settings, null, 2), {
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
