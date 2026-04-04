import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  OPENROUTER_PROVIDER_LABEL,
} from "../constants/openrouter.js";

export type ProviderTransport = "openai-compatible" | "unimplemented";
export type ProviderAuthKind =
  | "api-key"
  | "oauth"
  | "cloud-credentials"
  | "service-key"
  | "gateway"
  | "local-url";

export interface BuiltinProviderDefinition {
  id: string;
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
  aliases?: string[];
  help?: string;
}

function openAiCompatible(
  id: string,
  label: string,
  options: {
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
    help?: string;
  },
): BuiltinProviderDefinition {
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
    aliases: options.aliases,
    help: options.help,
  };
}

function catalogOnly(
  id: string,
  label: string,
  options: {
    envKeys: string[];
    modelEnvKeys?: string[];
    baseUrlEnvKeys?: string[];
    aliases?: string[];
    authKind: ProviderAuthKind;
    help: string;
  },
): BuiltinProviderDefinition {
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
    aliases: options.aliases,
    help: options.help,
  };
}

function envPrefixForProvider(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

const BUILTIN_PROVIDER_DEFINITIONS: BuiltinProviderDefinition[] = [
  openAiCompatible(OPENROUTER_PROVIDER_ID, OPENROUTER_PROVIDER_LABEL, {
    envKeys: ["OPENROUTER_API_KEY", "PEBBLE_API_KEY"],
    modelEnvKeys: ["OPENROUTER_MODEL", "PEBBLE_MODEL"],
    baseUrlEnvKeys: ["OPENROUTER_BASE_URL", "PEBBLE_API_BASE"],
    defaultModel: OPENROUTER_DEFAULT_MODEL,
    defaultBaseUrl: OPENROUTER_DEFAULT_BASE_URL,
    aliases: ["or"],
  }),
  openAiCompatible("openai", "OpenAI", {
    envKeys: ["OPENAI_API_KEY"],
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
  }),
  catalogOnly("anthropic", "Anthropic", {
    envKeys: ["ANTHROPIC_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Anthropic, but the built-in runtime still needs a dedicated Anthropic adapter instead of the current OpenAI-compatible transport.",
  }),
  catalogOnly("google", "Google Gemini", {
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    aliases: ["gemini"],
    authKind: "api-key",
    help: "Pebble has cataloged Google Gemini API-key mode, but the built-in runtime still needs a Gemini-specific adapter/tooling path.",
  }),
  openAiCompatible("xai", "xAI", {
    envKeys: ["XAI_API_KEY"],
    defaultModel: "grok-2-latest",
    defaultBaseUrl: "https://api.x.ai/v1",
  }),
  openAiCompatible("groq", "Groq", {
    envKeys: ["GROQ_API_KEY"],
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
  }),
  openAiCompatible("mistral", "Mistral", {
    envKeys: ["MISTRAL_API_KEY"],
    defaultModel: "mistral-large-latest",
    defaultBaseUrl: "https://api.mistral.ai/v1",
  }),
  openAiCompatible("deepseek", "DeepSeek", {
    envKeys: ["DEEPSEEK_API_KEY"],
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
  }),
  openAiCompatible("together", "Together AI", {
    envKeys: ["TOGETHER_API_KEY"],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    defaultBaseUrl: "https://api.together.xyz/v1",
  }),
  openAiCompatible("cerebras", "Cerebras", {
    envKeys: ["CEREBRAS_API_KEY"],
    defaultModel: "llama-3.3-70b",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
  }),
  openAiCompatible("deepinfra", "DeepInfra", {
    envKeys: ["DEEPINFRA_API_KEY"],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
  }),
  openAiCompatible("nvidia", "NVIDIA", {
    envKeys: ["NVIDIA_API_KEY"],
    defaultModel: "meta/llama-3.3-70b-instruct",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
  }),
  openAiCompatible("perplexity", "Perplexity", {
    envKeys: ["PERPLEXITY_API_KEY"],
    defaultModel: "sonar",
    defaultBaseUrl: "https://api.perplexity.ai",
  }),
  openAiCompatible("ollama", "Ollama", {
    envKeys: ["OLLAMA_API_KEY"],
    authKind: "local-url",
    defaultApiKey: "ollama-local",
    defaultModel: "llama3.2",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    aliases: ["ollama-local"],
    help: "Local Ollama runs typically use a URL-only setup; Pebble seeds the conventional local marker key when no explicit credential is configured.",
  }),
  openAiCompatible("litellm", "LiteLLM", {
    envKeys: ["LITELLM_API_KEY", "LITELLM_MASTER_KEY"],
    authKind: "local-url",
    defaultApiKey: "litellm-local",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "http://localhost:4000/v1",
    requiresApiKey: false,
  }),
  openAiCompatible("vllm", "vLLM", {
    envKeys: ["VLLM_API_KEY"],
    authKind: "local-url",
    defaultApiKey: "vllm-local",
    defaultModel: "local-model",
    defaultBaseUrl: "http://localhost:8000/v1",
    requiresApiKey: false,
  }),
  openAiCompatible("sglang", "SGLang", {
    envKeys: ["SGLANG_API_KEY"],
    authKind: "local-url",
    defaultApiKey: "sglang-local",
    defaultModel: "local-model",
    defaultBaseUrl: "http://localhost:30000/v1",
    requiresApiKey: false,
  }),
  openAiCompatible("custom-openai", "Custom OpenAI-Compatible Endpoint", {
    envKeys: ["CUSTOM_OPENAI_API_KEY", "CUSTOMOAI_API_KEY"],
    modelEnvKeys: ["CUSTOM_OPENAI_MODEL", "CUSTOMOAI_MODEL"],
    baseUrlEnvKeys: ["CUSTOM_OPENAI_BASE_URL", "CUSTOMOAI_BASE_URL"],
    aliases: ["customoai", "custom-openai-endpoint"],
    requiresBaseUrl: true,
    help: "Set a custom base URL plus model metadata to route Pebble through another OpenAI-compatible endpoint.",
  }),
  catalogOnly("github-copilot", "GitHub Copilot", {
    envKeys: ["GITHUB_COPILOT_TOKEN", "COPILOT_TOKEN"],
    aliases: ["copilot"],
    authKind: "oauth",
    help: "Pebble has cataloged GitHub Copilot, but the built-in runtime still needs device-flow OAuth and token exchange support.",
  }),
  catalogOnly("openai-codex", "OpenAI Codex / ChatGPT OAuth", {
    envKeys: ["OPENAI_CODEX_TOKEN", "CHATGPT_TOKEN"],
    aliases: ["codex"],
    authKind: "oauth",
    help: "Pebble has cataloged the ChatGPT/Codex OAuth path, but the built-in runtime currently only supports API-key OpenAI transport.",
  }),
  catalogOnly("google-gemini-cli", "Gemini CLI OAuth", {
    envKeys: ["GEMINI_CLI_TOKEN"],
    authKind: "oauth",
    help: "Pebble has cataloged Gemini CLI PKCE OAuth, but the built-in runtime still needs browser/device auth support.",
  }),
  catalogOnly("chutes", "Chutes", {
    envKeys: ["CHUTES_API_KEY", "CHUTES_ACCESS_TOKEN"],
    authKind: "oauth",
    help: "Pebble has cataloged Chutes, but the built-in runtime still needs dual OAuth/API-key auth handling and provider-specific transport wiring.",
  }),
  catalogOnly("minimax-portal", "MiniMax Portal", {
    envKeys: ["MINIMAX_PORTAL_TOKEN"],
    authKind: "oauth",
    help: "Pebble has cataloged MiniMax Portal OAuth, but the built-in runtime still needs portal-auth session handling.",
  }),
  catalogOnly("gitlab", "GitLab", {
    envKeys: ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN"],
    authKind: "oauth",
    help: "Pebble has cataloged GitLab OAuth/API-token auth, but the built-in runtime still needs the GitLab-specific request/auth behavior.",
  }),
  catalogOnly("amazon-bedrock", "Amazon Bedrock", {
    envKeys: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK"],
    aliases: ["bedrock"],
    authKind: "cloud-credentials",
    help: "Pebble has cataloged Amazon Bedrock, but the built-in runtime still needs AWS credential-chain and Bedrock request signing support.",
  }),
  catalogOnly("azure", "Azure OpenAI", {
    envKeys: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_TOKEN"],
    aliases: ["azure-openai"],
    authKind: "cloud-credentials",
    help: "Pebble has cataloged Azure OpenAI, but the built-in runtime still needs Azure endpoint/auth handling beyond a plain OpenAI-compatible base URL swap.",
  }),
  catalogOnly("azure-cognitive-services", "Azure Cognitive Services", {
    envKeys: ["AZURE_COGNITIVE_SERVICES_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Azure Cognitive Services, but the built-in runtime still needs the Azure resource-specific request path.",
  }),
  catalogOnly("google-vertex", "Google Vertex AI", {
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION"],
    authKind: "cloud-credentials",
    help: "Pebble has cataloged Google Vertex AI, but the built-in runtime still needs ADC/service-account auth and Vertex-specific request handling.",
  }),
  catalogOnly("google-vertex-anthropic", "Anthropic on Vertex", {
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION"],
    authKind: "cloud-credentials",
    help: "Pebble has cataloged Anthropic on Vertex, but the built-in runtime still needs both Vertex auth and Anthropic-specific request mapping.",
  }),
  catalogOnly("cloudflare-ai-gateway", "Cloudflare AI Gateway", {
    envKeys: ["CLOUDFLARE_API_TOKEN", "CF_AIG_TOKEN", "CLOUDFLARE_AI_GATEWAY_API_KEY"],
    authKind: "gateway",
    help: "Pebble has cataloged Cloudflare AI Gateway, but the built-in runtime still needs composite gateway + upstream-provider auth/header handling.",
  }),
  catalogOnly("cloudflare-workers-ai", "Cloudflare Workers AI", {
    envKeys: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
    authKind: "cloud-credentials",
    help: "Pebble has cataloged Cloudflare Workers AI, but the built-in runtime still needs account-aware Cloudflare request handling.",
  }),
  catalogOnly("cohere", "Cohere", {
    envKeys: ["COHERE_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Cohere, but the built-in runtime still needs a Cohere-specific adapter rather than the shared OpenAI-compatible transport.",
  }),
  catalogOnly("deepgram", "Deepgram", {
    envKeys: ["DEEPGRAM_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Deepgram, but it belongs on a media/transcription tool path instead of Pebble's chat-model runtime.",
  }),
  catalogOnly("zai", "Z.AI", {
    envKeys: ["ZAI_API_KEY"],
    aliases: ["glm"],
    authKind: "api-key",
    help: "Pebble has cataloged Z.AI / GLM, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("huggingface", "Hugging Face", {
    envKeys: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
    authKind: "api-key",
    help: "Pebble has cataloged Hugging Face, but the built-in runtime still needs a verified inference/chat transport path.",
  }),
  catalogOnly("kilo", "Kilo", {
    envKeys: ["KILO_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Kilo, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("kilocode", "Kilocode", {
    envKeys: ["KILOCODE_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Kilocode, but the built-in runtime still needs the smart-router request path and upstream-model reporting.",
  }),
  catalogOnly("minimax", "MiniMax", {
    envKeys: ["MINIMAX_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged MiniMax API-key mode, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("moonshot", "Moonshot", {
    envKeys: ["MOONSHOT_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Moonshot, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("kimi", "Kimi", {
    envKeys: ["KIMI_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Kimi, but the built-in runtime still needs the separate Kimi coding endpoint/model path.",
  }),
  catalogOnly("opencode", "OpenCode", {
    envKeys: ["OPENCODE_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged OpenCode, but the built-in runtime still needs the provider-specific catalog/routing path.",
  }),
  catalogOnly("opencode-go", "OpenCode Go", {
    envKeys: ["OPENCODE_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged OpenCode Go, but the built-in runtime still needs the provider-specific catalog/routing path.",
  }),
  catalogOnly("qianfan", "Qianfan", {
    envKeys: ["QIANFAN_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Qianfan, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("qwen", "Qwen / Model Studio", {
    envKeys: ["QWEN_API_KEY", "MODELSTUDIO_API_KEY", "DASHSCOPE_API_KEY"],
    aliases: ["model-studio"],
    authKind: "api-key",
    help: "Pebble has cataloged Qwen / Model Studio, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("sap-ai-core", "SAP AI Core", {
    envKeys: ["AICORE_SERVICE_KEY"],
    authKind: "service-key",
    help: "Pebble has cataloged SAP AI Core, but the built-in runtime still needs service-key parsing and enterprise deployment routing.",
  }),
  catalogOnly("stepfun", "StepFun", {
    envKeys: ["STEPFUN_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged StepFun, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("stepfun-plan", "StepFun Plan", {
    envKeys: ["STEPFUN_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged StepFun Plan, but the built-in runtime still needs the separate coding-plan endpoint/model path.",
  }),
  catalogOnly("synthetic", "Synthetic", {
    envKeys: ["SYNTHETIC_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Synthetic, but the built-in runtime still needs an Anthropic-compatible adapter instead of the shared OpenAI-compatible transport.",
  }),
  catalogOnly("venice", "Venice", {
    envKeys: ["VENICE_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Venice, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("vercel", "Vercel AI", {
    envKeys: ["VERCEL_API_KEY"],
    aliases: ["vercel-ai"],
    authKind: "api-key",
    help: "Pebble has cataloged Vercel AI, but the built-in runtime still needs the provider-specific gateway/header behavior.",
  }),
  catalogOnly("vercel-ai-gateway", "Vercel AI Gateway", {
    envKeys: ["AI_GATEWAY_API_KEY"],
    authKind: "gateway",
    help: "Pebble has cataloged Vercel AI Gateway, but the built-in runtime still needs gateway-specific auth/header handling.",
  }),
  catalogOnly("volcengine", "Volcengine", {
    envKeys: ["VOLCANO_ENGINE_API_KEY"],
    aliases: ["doubao"],
    authKind: "api-key",
    help: "Pebble has cataloged Volcengine, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("volcengine-plan", "Volcengine Plan", {
    envKeys: ["VOLCANO_ENGINE_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Volcengine Plan, but the built-in runtime still needs the separate coding-plan endpoint/model path.",
  }),
  catalogOnly("xiaomi", "Xiaomi", {
    envKeys: ["XIAOMI_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged Xiaomi, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("zenmux", "ZenMux", {
    envKeys: ["ZENMUX_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged ZenMux, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("byteplus", "BytePlus", {
    envKeys: ["BYTEPLUS_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged BytePlus, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
  }),
  catalogOnly("byteplus-plan", "BytePlus Plan", {
    envKeys: ["BYTEPLUS_API_KEY"],
    authKind: "api-key",
    help: "Pebble has cataloged BytePlus Plan, but the built-in runtime still needs the separate coding-plan endpoint/model path.",
  }),
];

const PROVIDER_ALIAS_TO_ID = new Map<string, string>();
for (const definition of BUILTIN_PROVIDER_DEFINITIONS) {
  PROVIDER_ALIAS_TO_ID.set(definition.id, definition.id);
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
  const normalized = normalizeProviderId(provider);
  return BUILTIN_PROVIDER_DEFINITIONS.find((definition) => definition.id === normalized);
}

export function applyProviderDefaults<T extends { provider?: string; model?: string; baseUrl?: string }>(value: T): T {
  const normalizedProvider = normalizeProviderId(value.provider);
  const definition = getBuiltinProviderDefinition(normalizedProvider);

  if (!definition) {
    return {
      ...value,
      provider: normalizedProvider,
      model: value.model?.trim() || undefined,
      baseUrl: value.baseUrl?.trim() || undefined,
    };
  }

  return {
    ...value,
    provider: definition.id,
    model: value.model?.trim() || definition.defaultModel || undefined,
    baseUrl: value.baseUrl?.trim() || definition.defaultBaseUrl || undefined,
  };
}