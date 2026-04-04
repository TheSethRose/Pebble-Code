import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
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
  maxTurns?: number;
  telemetryEnabled: boolean;
  compactThreshold?: number;
}

const DEFAULT_SETTINGS: Settings = {
  permissionMode: "always-ask",
  telemetryEnabled: false,
  maxTurns: 50,
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

/**
 * Build the full runtime configuration.
 */
export function buildRuntimeConfig(cwd: string): RuntimeConfig {
  const trust = buildTrustConfig(cwd);
  const configDir = join(trust.projectRoot, ".pebble");
  const settings = loadSettings(join(configDir, "settings.json"));
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
