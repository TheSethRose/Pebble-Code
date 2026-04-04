import type { Provider } from "./types.js";
import { createPrimaryProvider } from "./primary/index.js";
import {
  resolveProviderConfig,
  type ResolvedProviderConfig,
} from "./config.js";
import { getBuiltinProviderDefinitions, normalizeProviderId } from "./catalog.js";
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
    const configured = extensionProvider.isConfigured();
    const envKeyName = `${extensionProvider.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    return {
      provider: extensionProvider,
      source: "extension",
      providerId: extensionProvider.id,
      providerLabel: extensionProvider.name,
      model: extensionProvider.model,
      apiKey: "",
      apiKeyConfigured: configured,
      apiKeySource: configured ? "settings" : "unset",
      baseUrl: "managed-by-extension",
      baseUrlSource: "default",
      envKeyName,
      envKeyNames: [envKeyName],
      transport: "unimplemented",
      authKind: "api-key",
      implemented: true,
      runtimeReady: configured,
      missingConfiguration: configured ? [] : ["extension provider configuration"],
      help: "This provider is supplied by an extension and manages its own runtime transport.",
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
    ...getBuiltinProviderDefinitions().map((provider) => ({
      id: provider.id,
      name: provider.label,
      source: "builtin" as const,
    })),
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
  return normalizeProviderId(provider);
}
