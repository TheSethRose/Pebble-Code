import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  OPENROUTER_PROVIDER_LABEL,
} from "../constants/openrouter.js";
import {
  getBuiltinProviderDefinition,
  normalizeProviderId,
  type ProviderAuthKind,
  type ProviderTransport,
} from "./catalog.js";
import {
  getStoredProviderCredential,
  getStoredProviderOAuthSession,
  type Settings,
} from "../runtime/config.js";

type ConfigSource = "settings" | "env" | "default" | "unset";

export interface ResolvedProviderConfig {
  providerId: string;
  providerLabel: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  apiKeySource: ConfigSource;
  baseUrl: string;
  baseUrlSource: ConfigSource;
  envKeyName: string;
  envKeyNames: string[];
  transport: ProviderTransport;
  authKind: ProviderAuthKind;
  implemented: boolean;
  requestHeaders: Record<string, string>;
  exampleModels: string[];
  runtimeReady: boolean;
  missingConfiguration: string[];
  help?: string;
}

export function resolveProviderConfig(
  settings: Partial<Settings> = {},
  overrides: { provider?: string; model?: string } = {},
): ResolvedProviderConfig {
  const requestedProvider = normalizeProviderId(
    overrides.provider ?? settings.provider ?? process.env.PEBBLE_PROVIDER,
  );
  const definition = getBuiltinProviderDefinition(requestedProvider)
    ?? getBuiltinProviderDefinition(OPENROUTER_PROVIDER_ID);

  if (!definition) {
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
      envKeyNames: ["OPENROUTER_API_KEY"],
      transport: "openai-compatible",
      authKind: "api-key",
      implemented: true,
      requestHeaders: {},
      exampleModels: [OPENROUTER_DEFAULT_MODEL],
      runtimeReady: false,
      missingConfiguration: ["API key"],
    };
  }

  const settingsApiKey = getStoredProviderCredential(settings, definition.id);
  const storedOauth = getStoredProviderOAuthSession(settings, definition.id);
  const storedOauthToken = storedOauth?.accessToken?.trim() || storedOauth?.refreshToken?.trim() || "";
  const envApiKey = firstConfiguredEnv(definition.envKeys);
  const defaultApiKey = definition.defaultApiKey?.trim();
  const settingsBaseUrl = settings.baseUrl?.trim();
  const envBaseUrl = firstConfiguredEnv(definition.baseUrlEnvKeys);
  const model =
    overrides.model?.trim() ||
    settings.model?.trim() ||
    firstConfiguredEnv(definition.modelEnvKeys) ||
    definition.defaultModel ||
    "";
  const apiKey = settingsApiKey || storedOauthToken || envApiKey || defaultApiKey || "";
  const baseUrl = settingsBaseUrl || envBaseUrl || definition.defaultBaseUrl || "";
  const apiKeySource: ConfigSource = settingsApiKey
    ? "settings"
    : storedOauthToken
      ? "settings"
      : envApiKey
        ? "env"
        : defaultApiKey
          ? "default"
          : "unset";
  const baseUrlSource: ConfigSource = settingsBaseUrl
    ? "settings"
    : envBaseUrl
      ? "env"
      : definition.defaultBaseUrl
        ? "default"
        : "unset";
  const missingConfiguration: string[] = [];

  if (!model.trim()) {
    missingConfiguration.push("model");
  }

  if (definition.requiresBaseUrl && !baseUrl.trim()) {
    missingConfiguration.push("base URL");
  }

  if (definition.authKind === "oauth") {
    if (!apiKey.trim()) {
      missingConfiguration.push("OAuth login");
    }
  } else if (definition.requiresApiKey && !apiKey.trim()) {
    missingConfiguration.push("API key");
  }

  return {
    providerId: definition.id,
    providerLabel: definition.label,
    model,
    apiKey,
    apiKeyConfigured: definition.authKind === "oauth"
      ? Boolean(apiKey)
      : definition.requiresApiKey
        ? Boolean(apiKey)
        : true,
    apiKeySource,
    baseUrl,
    baseUrlSource,
    envKeyName: definition.envKeys[0] ?? "",
    envKeyNames: definition.envKeys,
    transport: definition.transport,
    authKind: definition.authKind,
    implemented: definition.implemented,
    requestHeaders: { ...(definition.requestHeaders ?? {}) },
    exampleModels: [...definition.exampleModels],
    runtimeReady: definition.implemented && missingConfiguration.length === 0,
    missingConfiguration,
    help: definition.help,
  };
}

export function getProviderNotConfiguredMessage(
  config: ResolvedProviderConfig,
): string {
  if (!config.implemented) {
    return `${config.providerLabel} is cataloged in Pebble, but its built-in runtime path is not implemented yet. ${config.help ?? "See docs/PROVIDERS.md for the required auth and transport details."}`;
  }

  const hints: string[] = [];
  if (config.missingConfiguration.includes("OAuth login")) {
    hints.push(`run /login ${config.providerId}`);
  }
  if (config.missingConfiguration.includes("API key") && config.envKeyNames.length > 0) {
    hints.push(`set ${config.envKeyNames.join(" or ")}`);
  }
  if (config.missingConfiguration.includes("base URL") && config.baseUrlSource === "unset") {
    hints.push("configure a base URL in settings or env");
  }
  if (config.missingConfiguration.includes("model")) {
    hints.push("set a model in settings, env, or /model");
  }

  const detail = config.missingConfiguration.length > 0
    ? `missing ${config.missingConfiguration.join(", ")}`
    : "configuration is incomplete";
  const guidance = hints.length > 0 ? ` — ${hints.join("; ")}` : "";
  return `${config.providerLabel} is not configured (${detail})${guidance}.`;
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

function firstConfiguredEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}