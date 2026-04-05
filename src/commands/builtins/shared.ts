import type { Settings } from "../../runtime/config.js";
import {
  getStoredProviderAuthToken,
  loadSettingsForCwd,
  saveSettingsForCwd,
} from "../../runtime/config.js";
import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
} from "../../constants/openrouter.js";
import { applyProviderDefaults, normalizeProviderId } from "../../providers/catalog.js";
import { createProjectSessionStore } from "../../persistence/runtimeSessions.js";
import type { CommandContext, CommandResult } from "../types.js";

export function getSessionStore(ctx: CommandContext) {
  return ctx.sessionStore ?? createProjectSessionStore(ctx.cwd);
}

export function getActiveSession(ctx: CommandContext, requestedId?: string) {
  const store = getSessionStore(ctx);
  if (requestedId) {
    return store.loadTranscript(requestedId);
  }

  if (ctx.sessionId) {
    return store.loadTranscript(ctx.sessionId);
  }

  return store.getLatestSession();
}

export function loadProjectSettings(ctx: CommandContext): Settings {
  return loadSettingsForCwd(ctx.cwd);
}

export function saveProjectSettings(ctx: CommandContext, settings: Settings): string {
  return saveSettingsForCwd(ctx.cwd, settings);
}

export function ensureProviderDefaults(settings: Settings): Settings {
  const withDefaults = applyProviderDefaults(settings);
  const activeCredential = getStoredProviderAuthToken(withDefaults, withDefaults.provider);
  if (withDefaults.provider === OPENROUTER_PROVIDER_ID) {
    return {
      ...withDefaults,
      apiKey: activeCredential,
      model: withDefaults.model?.trim() || OPENROUTER_DEFAULT_MODEL,
      baseUrl: withDefaults.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
    };
  }

  return {
    ...withDefaults,
    apiKey: activeCredential,
    model: withDefaults.model?.trim(),
    baseUrl: withDefaults.baseUrl?.trim(),
  };
}

export function getCurrentProviderId(ctx: CommandContext): string {
  const provider = typeof ctx.config.provider === "string"
    ? ctx.config.provider
    : loadProjectSettings(ctx).provider;
  return normalizeProviderId(provider);
}

export function createConfigUpdatedResult(output: string, settingsPath: string): CommandResult {
  return {
    success: true,
    output,
    data: {
      action: "config-updated",
      settingsPath,
    },
  };
}