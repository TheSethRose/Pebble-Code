import type { Provider } from "./types.js";
import { createPrimaryProvider } from "./primary/index.js";
import {
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from "./config.js";
import type { Settings } from "../runtime/config.js";

export interface RuntimeProviderResolution extends ResolvedProviderConfig {
  provider: Provider;
  source: "builtin" | "extension";
}

export function resolveRuntimeProvider(
  settings: Partial<Settings> = {},
  overrides: { provider?: string; model?: string } = {},
  extensionProviders: Provider[] = [],
): RuntimeProviderResolution {
  const requestedProvider = normalizeRuntimeProviderId(
    overrides.provider ?? settings.provider,
  );
  const extensionProvider = extensionProviders.find(
    (provider) => normalizeRuntimeProviderId(provider.id) === requestedProvider,
  );

  if (extensionProvider) {
    return {
      provider: extensionProvider,
      source: "extension",
      providerId: extensionProvider.id,
      providerLabel: extensionProvider.name,
      model: extensionProvider.model,
      apiKey: "",
      apiKeyConfigured: extensionProvider.isConfigured(),
      apiKeySource: extensionProvider.isConfigured() ? "settings" : "unset",
      baseUrl: "managed-by-extension",
      baseUrlSource: "default",
      envKeyName: `${extensionProvider.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`,
    };
  }

  const provider = createPrimaryProvider({
    settings,
    provider: overrides.provider,
    model: overrides.model,
  });
  const config = resolveProviderConfig(settings, overrides);

  return {
    ...config,
    provider,
    source: "builtin",
  };
}

export function listRuntimeProviders(extensionProviders: Provider[] = []): Array<{
  id: string;
  name: string;
  source: "builtin" | "extension";
}> {
  const providers = [
    { id: "openrouter", name: "OpenRouter", source: "builtin" as const },
    ...extensionProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      source: "extension" as const,
    })),
  ];

  const seen = new Set<string>();
  return providers.filter((provider) => {
    const normalized = normalizeRuntimeProviderId(provider.id);
    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function normalizeRuntimeProviderId(provider?: string): string {
  return provider?.trim().toLowerCase() || "openrouter";
}
