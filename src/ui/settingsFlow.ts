import {
  getBuiltinProviderDefinition,
  getProviderCredentialLabel,
  normalizeProviderId,
  providerSupportsConfigurableBaseUrl,
  providerSupportsManualCredentialEntry,
} from "../providers/catalog.js";
import { resolveProviderConfig } from "../providers/config.js";
import {
  getStoredProviderCredential,
  getStoredProviderOAuthSession,
  type Settings,
} from "../runtime/config.js";

export interface ProviderAuthFollowUp {
  providerId: string;
  notice: string;
}

export interface ProviderAuthStatus {
  providerId: string;
  isConfigured: boolean;
  hasCredential: boolean;
  baseUrlConfigured: boolean;
  source: "settings" | "env" | "default" | "none";
  credential?: string;
  envKey?: string;
}

function getConfiguredEnvSignal(
  envKeys: string[],
): { key: string; value: string } | null {
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value) {
      return { key, value };
    }
  }

  return null;
}

export function getProviderAuthStatus(
  settings: Partial<Settings>,
  providerId: string,
): ProviderAuthStatus {
  const normalizedProviderId = normalizeProviderId(providerId);
  const definition = getBuiltinProviderDefinition(normalizedProviderId);

  if (!definition) {
    return {
      providerId: normalizedProviderId,
      isConfigured: false,
      hasCredential: false,
      baseUrlConfigured: false,
      source: "none",
    };
  }

  const resolved = resolveProviderConfig({
    ...settings,
    provider: normalizedProviderId,
  });
  const baseUrlConfigured = !providerSupportsConfigurableBaseUrl(definition)
    || Boolean(resolved.baseUrl.trim());

  const buildStatus = (params: {
    hasCredential: boolean;
    source: ProviderAuthStatus["source"];
    credential?: string;
    envKey?: string;
  }): ProviderAuthStatus => ({
    providerId: normalizedProviderId,
    isConfigured: params.hasCredential && baseUrlConfigured,
    hasCredential: params.hasCredential,
    baseUrlConfigured,
    source: params.source,
    ...(params.credential ? { credential: params.credential } : {}),
    ...(params.envKey ? { envKey: params.envKey } : {}),
  });

  const storedCredential = getStoredProviderCredential(settings, normalizedProviderId)?.trim();
  if (storedCredential) {
    return buildStatus({
      hasCredential: true,
      source: "settings",
      credential: storedCredential,
    });
  }

  const storedOauth = getStoredProviderOAuthSession(settings, normalizedProviderId);
  const storedOauthToken = storedOauth?.accessToken?.trim() || storedOauth?.refreshToken?.trim();
  if (storedOauthToken) {
    return buildStatus({
      hasCredential: true,
      source: "settings",
      credential: storedOauthToken,
    });
  }

  const envSignal = getConfiguredEnvSignal(definition.envKeys);
  if (envSignal) {
    return buildStatus({
      hasCredential: true,
      source: "env",
      credential: envSignal.value,
      envKey: envSignal.key,
    });
  }

  const defaultCredential = definition.defaultApiKey?.trim();
  if (defaultCredential) {
    return buildStatus({
      hasCredential: true,
      source: "default",
      credential: defaultCredential,
    });
  }

  if (definition.authKind === "local-url" && !definition.requiresApiKey) {
    return buildStatus({
      hasCredential: true,
      source: "default",
    });
  }

  return buildStatus({
    hasCredential: false,
    source: "none",
  });
}

export function getProviderSelectionAuthFollowUp(
  settings: Partial<Settings>,
  providerId: string,
): ProviderAuthFollowUp | null {
  const normalizedProviderId = normalizeProviderId(providerId);
  const definition = getBuiltinProviderDefinition(normalizedProviderId);

  if (!definition) {
    return null;
  }

  const authStatus = getProviderAuthStatus(settings, normalizedProviderId);
  const resolved = resolveProviderConfig({
    ...settings,
    provider: normalizedProviderId,
  });
  const hasConfiguredCredential = authStatus.hasCredential;

  if (definition.authKind === "local-url") {
    if (resolved.runtimeReady) {
      return null;
    }

    return {
      providerId: normalizedProviderId,
      notice: `${definition.label} still needs its local URL/runtime configured before Pebble can use it.`,
    };
  }

  if (providerSupportsManualCredentialEntry(definition)) {
    if (resolved.runtimeReady) {
      return null;
    }

    const missingBaseUrl = resolved.missingConfiguration.includes("base URL");
    const missingCredential = !hasConfiguredCredential;

    if (missingCredential && missingBaseUrl) {
      return {
        providerId: normalizedProviderId,
        notice: `${definition.label} is not configured yet. Enter your ${getProviderCredentialLabel(definition)} and base URL before using this provider.`,
      };
    }

    if (missingCredential) {
      return {
        providerId: normalizedProviderId,
        notice: `${definition.label} is not configured yet. Enter your ${getProviderCredentialLabel(definition)} before using this provider.`,
      };
    }

    if (missingBaseUrl) {
      return {
        providerId: normalizedProviderId,
        notice: `${definition.label} still needs its base URL configured before Pebble can use it.`,
      };
    }

    return null;
  }

  if (definition.authKind === "oauth" && !hasConfiguredCredential) {
    return {
      providerId: normalizedProviderId,
      notice: definition.implemented
        ? `${definition.label} is not configured yet. Pebble will start its OAuth login flow automatically when you open the Auth step for this provider.`
        : `${definition.label} is not configured yet. Run /login ${normalizedProviderId} from the main prompt to start its OAuth login flow.`,
    };
  }

  if (definition.authKind === "cloud-credentials" && !hasConfiguredCredential) {
    return {
      providerId: normalizedProviderId,
      notice: `${definition.label} is not configured yet. Set up its cloud credentials here before using this provider.`,
    };
  }

  return null;
}