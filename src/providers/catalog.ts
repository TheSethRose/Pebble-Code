import { OPENROUTER_PROVIDER_ID } from "../constants/openrouter.js";
import { BUILTIN_PROVIDER_DEFINITIONS } from "./registry.js";
import type { BuiltinProviderDefinition } from "./providerDefinition.js";

export type {
  BuiltinProviderDefinition,
  ProviderAuthKind,
  ProviderTransport,
} from "./providerDefinition.js";

function resolveDefinition(
  provider?: string | BuiltinProviderDefinition,
): BuiltinProviderDefinition | undefined {
  if (!provider) {
    return undefined;
  }

  return typeof provider === "string"
    ? getBuiltinProviderDefinition(provider)
    : provider;
}

function getSupportedAuthKinds(
  definition?: BuiltinProviderDefinition,
): ProviderAuthKind[] {
  if (!definition) {
    return [];
  }

  return [...new Set([definition.authKind, ...(definition.additionalAuthKinds ?? [])])];
}

function describeAuthKind(kind: ProviderAuthKind): string {
  switch (kind) {
    case "oauth":
      return "browser/device OAuth";
    case "cloud-credentials":
      return "cloud credentials or IAM identity";
    case "gateway":
      return "gateway/proxy tokens";
    case "service-key":
      return "a service key / enterprise credential";
    case "local-url":
      return "a local/self-hosted URL with an optional marker key";
    case "api-key":
    default:
      return "direct API-key authentication";
  }
}

export function providerSupportsManualCredentialEntry(
  provider?: string | BuiltinProviderDefinition,
): boolean {
  const definition = resolveDefinition(provider);
  if (!definition) {
    return false;
  }

  return getSupportedAuthKinds(definition).some((kind) => kind === "api-key"
    || kind === "gateway"
    || kind === "service-key"
    || kind === "local-url");
}

export function getProviderCredentialLabel(
  provider?: string | BuiltinProviderDefinition,
): string {
  const definition = resolveDefinition(provider);
  switch (definition?.authKind) {
    case "gateway":
      return "gateway token";
    case "service-key":
      return "service key";
    case "local-url":
      return "local token / marker key";
    case "oauth":
      return "OAuth session";
    case "cloud-credentials":
      return "cloud credentials";
    case "api-key":
    default:
      return "API key";
  }
}

export function getProviderAuthDescription(
  provider?: string | BuiltinProviderDefinition,
): string {
  const definition = resolveDefinition(provider);
  if (!definition) {
    return "Configure a provider first.";
  }

  const authKinds = getSupportedAuthKinds(definition);
  if (authKinds.length > 1) {
    const describedKinds = authKinds.map(describeAuthKind);
    return `${definition.label} supports ${describedKinds.join(" and ")}.`;
  }

  switch (definition.authKind) {
    case "oauth":
      return definition.implemented
        ? `${definition.label} uses browser/device OAuth. Run /login ${definition.id} to start the sign-in flow.`
        : `${definition.label} uses browser/device OAuth. Pebble catalogs that flow, but direct OAuth login is not implemented yet.`;
    case "cloud-credentials":
      return `${definition.label} uses cloud credentials or IAM identity instead of a single API key.`;
    case "gateway":
      return `${definition.label} routes through a gateway or proxy token and may also need upstream provider credentials.`;
    case "service-key":
      return `${definition.label} uses a service key / enterprise credential instead of a standard API token.`;
    case "local-url":
      return `${definition.label} usually runs against a local or self-hosted URL and may only need a marker key.`;
    case "api-key":
    default:
      return `${definition.label} uses direct API-key authentication.`;
  }
}

export function providerSupportsConfigurableBaseUrl(
  provider?: string | BuiltinProviderDefinition,
): boolean {
  const definition = resolveDefinition(provider);
  if (!definition) {
    return false;
  }

  return definition.transport === "openai-compatible"
    || definition.requiresBaseUrl
    || Boolean(definition.defaultBaseUrl)
    || definition.baseUrlEnvKeys.length > 0;
}

export function getProviderBaseUrlPlaceholder(
  provider?: string | BuiltinProviderDefinition,
): string {
  const definition = resolveDefinition(provider);
  if (!definition) {
    return "http://localhost:8080/v1";
  }

  return definition.defaultBaseUrl
    || (definition.transport === "openai-compatible"
      ? "http://localhost:8080/v1"
      : "https://example.com/api");
}

export function getProviderBaseUrlDescription(
  provider?: string | BuiltinProviderDefinition,
): string {
  const definition = resolveDefinition(provider);
  if (!definition) {
    return "Use the API root URL Pebble should call, usually ending in /v1.";
  }

  if (definition.transport === "openai-compatible") {
    return `Use the OpenAI-compatible API root Pebble should call, usually ending in /v1 (for example ${getProviderBaseUrlPlaceholder(definition)}). Do not paste a full /chat/completions, /responses, or /models URL; Pebble appends /models and /chat/completions itself.`;
  }

  return `Use the API root URL Pebble should call${definition.defaultBaseUrl ? ` (default: ${definition.defaultBaseUrl})` : ""}.`;
}

const PROVIDER_DEFINITIONS_BY_ID = new Map<string, BuiltinProviderDefinition>(
  BUILTIN_PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const PROVIDER_ALIAS_TO_ID = new Map<string, string>();
for (const definition of BUILTIN_PROVIDER_DEFINITIONS) {
  PROVIDER_ALIAS_TO_ID.set(definition.id.toLowerCase(), definition.id);
  for (const alias of definition.aliases ?? []) {
    PROVIDER_ALIAS_TO_ID.set(alias.toLowerCase(), definition.id);
  }
}

export type SupportedProviderId = (typeof BUILTIN_PROVIDER_DEFINITIONS)[number]["id"];

export const SUPPORTED_PROVIDER_IDS = BUILTIN_PROVIDER_DEFINITIONS.map((definition) => definition.id) as string[];

export function normalizeProviderId(provider?: string): string {
  const normalized = provider?.trim().toLowerCase() || OPENROUTER_PROVIDER_ID;
  return PROVIDER_ALIAS_TO_ID.get(normalized) ?? normalized;
}

export function isSupportedProvider(provider?: string): boolean {
  return getBuiltinProviderDefinition(provider) !== undefined;
}

export function getBuiltinProviderDefinitions(): BuiltinProviderDefinition[] {
  return [...BUILTIN_PROVIDER_DEFINITIONS];
}

export function getBuiltinProviderDefinition(provider?: string): BuiltinProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS_BY_ID.get(normalizeProviderId(provider));
}

export function normalizeProviderModelId(provider: string | undefined, model: string | undefined): string | undefined {
  const normalizedProvider = normalizeProviderId(provider);
  const trimmedModel = model?.trim();

  if (!trimmedModel) {
    return undefined;
  }

  if (normalizedProvider === "github-copilot") {
    return trimmedModel.replace(/^github-copilot\//, "") || undefined;
  }

  return trimmedModel;
}

export function applyProviderDefaults<T extends { provider?: string; model?: string; baseUrl?: string }>(value: T): T {
  const normalizedProvider = normalizeProviderId(value.provider);
  const definition = getBuiltinProviderDefinition(normalizedProvider);

  if (!definition) {
    return {
      ...value,
      provider: normalizedProvider,
      model: normalizeProviderModelId(normalizedProvider, value.model),
      baseUrl: value.baseUrl?.trim() || undefined,
    };
  }

  return {
    ...value,
    provider: definition.id,
    model: normalizeProviderModelId(definition.id, value.model) ?? (definition.defaultModel || undefined),
    baseUrl: value.baseUrl?.trim() || definition.defaultBaseUrl || undefined,
  };
}