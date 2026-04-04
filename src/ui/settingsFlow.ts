import {
  getBuiltinProviderDefinition,
  getProviderCredentialLabel,
  normalizeProviderId,
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
      source: "none",
    };
  }

  const storedCredential = getStoredProviderCredential(settings, normalizedProviderId)?.trim();
  if (storedCredential) {
    return {
      providerId: normalizedProviderId,
      isConfigured: true,
      source: "settings",
      credential: storedCredential,
    };
  }

  const storedOauth = getStoredProviderOAuthSession(settings, normalizedProviderId);
  const storedOauthToken = storedOauth?.accessToken?.trim() || storedOauth?.refreshToken?.trim();
  if (storedOauthToken) {
    return {
      providerId: normalizedProviderId,
      isConfigured: true,
      source: "settings",
      credential: storedOauthToken,
    };
  }

  const envSignal = getConfiguredEnvSignal(definition.envKeys);
  if (envSignal) {
    return {
      providerId: normalizedProviderId,
      isConfigured: true,
      source: "env",
      credential: envSignal.value,
      envKey: envSignal.key,
    };
  }

  const defaultCredential = definition.defaultApiKey?.trim();
  if (defaultCredential) {
    return {
      providerId: normalizedProviderId,
      isConfigured: true,
      source: "default",
      credential: defaultCredential,
    };
  }

  return {
    providerId: normalizedProviderId,
    isConfigured: false,
    source: "none",
  };
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
  const hasConfiguredCredential = authStatus.isConfigured;

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

    if (!hasConfiguredCredential) {
      return {
        providerId: normalizedProviderId,
        notice: `${definition.label} is not configured yet. Enter your ${getProviderCredentialLabel(definition)} before using this provider.`,
      };
    }

    if (resolved.missingConfiguration.includes("base URL")) {
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