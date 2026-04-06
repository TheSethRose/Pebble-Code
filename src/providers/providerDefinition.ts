export type ProviderTransport = "openai-compatible" | "unimplemented";
export type ProviderAuthKind =
  | "api-key"
  | "oauth"
  | "cloud-credentials"
  | "service-key"
  | "gateway"
  | "local-url";

export interface BuiltinProviderDefinition<TId extends string = string> {
  id: TId;
  label: string;
  transport: ProviderTransport;
  authKind: ProviderAuthKind;
  envKeys: string[];
  modelEnvKeys: string[];
  baseUrlEnvKeys: string[];
  defaultModel?: string;
  defaultBaseUrl?: string;
  defaultApiKey?: string;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  implemented: boolean;
  exampleModels: string[];
  requestHeaders?: Record<string, string>;
  aliases?: string[];
  help?: string;
}

type OpenAiCompatibleOptions = {
  envKeys: string[];
  modelEnvKeys?: string[];
  baseUrlEnvKeys?: string[];
  defaultModel?: string;
  defaultBaseUrl?: string;
  defaultApiKey?: string;
  aliases?: string[];
  authKind?: ProviderAuthKind;
  requiresApiKey?: boolean;
  requiresBaseUrl?: boolean;
  exampleModels?: string[];
  requestHeaders?: Record<string, string>;
  help?: string;
};

type CatalogOnlyOptions = {
  envKeys: string[];
  modelEnvKeys?: string[];
  baseUrlEnvKeys?: string[];
  aliases?: string[];
  authKind: ProviderAuthKind;
  help: string;
};

function compactModels(...values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value?.trim()));
}

function envPrefixForProvider(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function openAiCompatible<const TId extends string>(
  id: TId,
  label: string,
  options: OpenAiCompatibleOptions,
): BuiltinProviderDefinition<TId> {
  return {
    id,
    label,
    transport: "openai-compatible",
    authKind: options.authKind ?? "api-key",
    envKeys: options.envKeys,
    modelEnvKeys: options.modelEnvKeys ?? [`${envPrefixForProvider(id)}_MODEL`],
    baseUrlEnvKeys: options.baseUrlEnvKeys ?? [`${envPrefixForProvider(id)}_BASE_URL`],
    defaultModel: options.defaultModel,
    defaultBaseUrl: options.defaultBaseUrl,
    defaultApiKey: options.defaultApiKey,
    requiresApiKey: options.requiresApiKey ?? true,
    requiresBaseUrl: options.requiresBaseUrl ?? true,
    implemented: true,
    exampleModels: options.exampleModels ?? compactModels(options.defaultModel),
    requestHeaders: options.requestHeaders,
    aliases: options.aliases,
    help: options.help,
  };
}

export function catalogOnly<const TId extends string>(
  id: TId,
  label: string,
  options: CatalogOnlyOptions,
): BuiltinProviderDefinition<TId> {
  return {
    id,
    label,
    transport: "unimplemented",
    authKind: options.authKind,
    envKeys: options.envKeys,
    modelEnvKeys: options.modelEnvKeys ?? [`${envPrefixForProvider(id)}_MODEL`],
    baseUrlEnvKeys: options.baseUrlEnvKeys ?? [`${envPrefixForProvider(id)}_BASE_URL`],
    requiresApiKey: options.authKind === "api-key" || options.authKind === "gateway" || options.authKind === "service-key",
    requiresBaseUrl: options.authKind === "gateway" || options.authKind === "local-url",
    implemented: false,
    exampleModels: [],
    aliases: options.aliases,
    help: options.help,
  };
}