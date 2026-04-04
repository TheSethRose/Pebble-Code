import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import {
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
  telemetryEnabled: false,
  maxTurns: 50,
  fullscreenRenderer: true,
};

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
export function loadSettings(configPath: string): Settings {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getConfigDir(cwd: string): string {
  const trust = buildTrustConfig(cwd);
  return join(trust.projectRoot, ".pebble");
}

export function getSettingsPath(cwd: string): string {
  return join(getConfigDir(cwd), "settings.json");
}

export function loadSettingsForCwd(cwd: string): Settings {
  return loadSettings(getSettingsPath(cwd));
}

/**
 * Save settings to a JSON file.
 */
export function saveSettings(configPath: string, settings: Settings): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf-8");
}

export function saveSettingsForCwd(cwd: string, settings: Settings): string {
  const settingsPath = getSettingsPath(cwd);
  saveSettings(settingsPath, settings);
  return settingsPath;
}

/**
 * Build the full runtime configuration.
 */
export function buildRuntimeConfig(cwd: string): RuntimeConfig {
  const trust = buildTrustConfig(cwd);
  const settings = loadSettings(getSettingsPath(trust.projectRoot));
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
