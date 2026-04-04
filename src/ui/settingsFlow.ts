import {
  getBuiltinProviderDefinition,
  getProviderCredentialLabel,
  normalizeProviderId,
  providerSupportsManualCredentialEntry,
} from "../providers/catalog.js";
import { resolveProviderConfig } from "../providers/config.js";
import { getStoredProviderCredential, type Settings } from "../runtime/config.js";

export interface ProviderAuthFollowUp {
  providerId: string;
  notice: string;
}

function hasConfiguredEnvSignal(envKeys: string[]): boolean {
  return envKeys.some((key) => Boolean(process.env[key]?.trim()));
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

  const resolved = resolveProviderConfig({
    ...settings,
    provider: normalizedProviderId,
  });
  const hasStoredCredential = Boolean(
    getStoredProviderCredential(settings, normalizedProviderId),
  );
  const hasEnvCredential = hasConfiguredEnvSignal(definition.envKeys);
  const hasConfiguredCredential = hasStoredCredential
    || hasEnvCredential
    || Boolean(definition.defaultApiKey?.trim());

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
      notice: `${definition.label} is not configured yet. Start its OAuth login flow here before using this provider.`,
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