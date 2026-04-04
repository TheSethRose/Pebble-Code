/**
 * OpenRouter provider defaults for Pebble Code.
 */

export const OPENROUTER_PROVIDER_ID = "openrouter" as const;
export const OPENROUTER_PROVIDER_LABEL = "OpenRouter" as const;
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1" as const;
export const OPENROUTER_DEFAULT_MODEL = "openrouter/auto" as const;

export type SupportedProviderId = typeof OPENROUTER_PROVIDER_ID;

export const SUPPORTED_PROVIDER_IDS = [OPENROUTER_PROVIDER_ID] as const;

export function normalizeProviderId(provider?: string): string {
  return provider?.trim().toLowerCase() || OPENROUTER_PROVIDER_ID;
}

export function isSupportedProvider(
  provider?: string,
): provider is SupportedProviderId {
  return SUPPORTED_PROVIDER_IDS.includes(
    normalizeProviderId(provider) as SupportedProviderId,
  );
}