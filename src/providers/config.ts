import {
  isSupportedProvider,
  normalizeProviderId,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  OPENROUTER_PROVIDER_LABEL,
} from "../constants/openrouter.js";
import type { Settings } from "../runtime/config.js";

type ConfigSource = "settings" | "env" | "default" | "unset";

export interface ResolvedProviderConfig {
  providerId: string;
  providerLabel: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiKeySource: Extract<ConfigSource, "settings" | "env" | "unset">;
  baseUrl: string;
  baseUrlSource: Extract<ConfigSource, "settings" | "env" | "default">;
  envKeyName: string;
}

export function resolveProviderConfig(
  settings: Partial<Settings> = {},
  overrides: { provider?: string; model?: string } = {},
): ResolvedProviderConfig {
  const requestedProvider = normalizeProviderId(
    overrides.provider ?? settings.provider ?? process.env.PEBBLE_PROVIDER,
  );
  const providerId = isSupportedProvider(requestedProvider)
    ? requestedProvider
    : OPENROUTER_PROVIDER_ID;

  if (providerId === OPENROUTER_PROVIDER_ID) {
    const settingsApiKey = settings.apiKey?.trim();
    const envApiKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.PEBBLE_API_KEY?.trim();
    const settingsBaseUrl = settings.baseUrl?.trim();
    const envBaseUrl = process.env.OPENROUTER_BASE_URL?.trim() || process.env.PEBBLE_API_BASE?.trim();
    const model =
      overrides.model?.trim() ||
      settings.model?.trim() ||
      process.env.OPENROUTER_MODEL?.trim() ||
      process.env.PEBBLE_MODEL?.trim() ||
      OPENROUTER_DEFAULT_MODEL;

    return {
      providerId,
      providerLabel: OPENROUTER_PROVIDER_LABEL,
      model,
      apiKey: settingsApiKey || envApiKey || "",
      apiKeyConfigured: Boolean(settingsApiKey || envApiKey),
      apiKeySource: settingsApiKey ? "settings" : envApiKey ? "env" : "unset",
      baseUrl: settingsBaseUrl || envBaseUrl || OPENROUTER_DEFAULT_BASE_URL,
      baseUrlSource: settingsBaseUrl ? "settings" : envBaseUrl ? "env" : "default",
      envKeyName: "OPENROUTER_API_KEY",
    };
  }

  return {
    providerId: OPENROUTER_PROVIDER_ID,
    providerLabel: OPENROUTER_PROVIDER_LABEL,
    model: OPENROUTER_DEFAULT_MODEL,
    apiKey: "",
    apiKeyConfigured: false,
    apiKeySource: "unset",
    baseUrl: OPENROUTER_DEFAULT_BASE_URL,
    baseUrlSource: "default",
    envKeyName: "OPENROUTER_API_KEY",
  };
}

export function getProviderNotConfiguredMessage(
  config: ResolvedProviderConfig,
): string {
  return `${config.providerLabel} is not configured — run /login <api-key>, /config api-key <api-key>, or set ${config.envKeyName}.`;
}

export function maskSecret(value?: string | null): string {
  if (!value) {
    return "not set";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}•••`;
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}