import { describe, expect, test } from "bun:test";
import {
  getProviderNotConfiguredMessage,
  resolveProviderConfig,
} from "../src/providers/config";
import {
  getBuiltinProviderDefinition,
  getProviderBaseUrlDescription,
  providerSupportsManualCredentialEntry,
  providerSupportsConfigurableBaseUrl,
} from "../src/providers/catalog";
import { listRuntimeProviders } from "../src/providers/runtime";

describe("provider config resolution", () => {
  test("defaults to OpenRouter when no settings are present", () => {
    const previousOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
    const previousPebbleApiKey = process.env.PEBBLE_API_KEY;

    delete process.env.OPENROUTER_API_KEY;
    delete process.env.PEBBLE_API_KEY;

    const resolved = resolveProviderConfig({});

    process.env.OPENROUTER_API_KEY = previousOpenRouterApiKey;
    process.env.PEBBLE_API_KEY = previousPebbleApiKey;

    expect(resolved.providerId).toBe("openrouter");
    expect(resolved.providerLabel).toBe("OpenRouter");
    expect(resolved.model).toBe("openrouter/auto");
    expect(resolved.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(resolved.apiKeyConfigured).toBe(false);
    expect(resolved.envKeyName).toBe("OPENROUTER_API_KEY");
  });

  test("prefers saved settings over env fallbacks", () => {
    const resolved = resolveProviderConfig({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      baseUrl: "https://example.com/v1",
      providerAuth: {
        openrouter: { credential: "saved-key" },
      },
    });

    expect(resolved.model).toBe("anthropic/claude-sonnet-4.6");
    expect(resolved.baseUrl).toBe("https://example.com/v1");
    expect(resolved.apiKey).toBe("saved-key");
    expect(resolved.apiKeySource).toBe("settings");
  });

  test("resolves per-provider stored credentials even when another provider is active", () => {
    const resolved = resolveProviderConfig(
      {
        provider: "openai",
        providerAuth: {
          openai: { credential: "sk-openai-active" },
          groq: { credential: "gsk_groq_saved" },
        },
      },
      { provider: "groq" },
    );

    expect(resolved.providerId).toBe("groq");
    expect(resolved.apiKey).toBe("gsk_groq_saved");
    expect(resolved.apiKeySource).toBe("settings");
  });

  test("resolves OpenAI config with provider-specific defaults", () => {
    const resolved = resolveProviderConfig({
      provider: "openai",
      providerAuth: {
        openai: { credential: "sk-openai-test" },
      },
    });

    expect(resolved.providerId).toBe("openai");
    expect(resolved.providerLabel).toBe("OpenAI");
    expect(resolved.model).toBe("gpt-4o-mini");
    expect(resolved.baseUrl).toBe("https://api.openai.com/v1");
    expect(resolved.envKeyName).toBe("OPENAI_API_KEY");
    expect(resolved.transport).toBe("openai-compatible");
    expect(resolved.implemented).toBe(true);
    expect(resolved.runtimeReady).toBe(true);
  });

  test("resolves GitHub Copilot when an OAuth session is stored", () => {
    const resolved = resolveProviderConfig({
      provider: "github-copilot",
      providerAuth: {
        "github-copilot": {
          oauth: {
            accessToken: "ghu_copilot_device_token",
            tokenType: "github-device",
          },
        },
      },
    });

    expect(resolved.providerId).toBe("github-copilot");
    expect(resolved.providerLabel).toBe("GitHub Copilot");
    expect(resolved.model).toBe("gpt-4o");
    expect(resolved.baseUrl).toBe("https://api.individual.githubcopilot.com");
    expect(resolved.apiKey).toBe("ghu_copilot_device_token");
    expect(resolved.apiKeySource).toBe("settings");
    expect(resolved.authKind).toBe("oauth");
    expect(resolved.implemented).toBe(true);
    expect(resolved.runtimeReady).toBe(true);
    expect(resolved.requestHeaders["Editor-Version"]).toBeDefined();
  });

  test("prefers the saved OAuth session over a stale saved credential for GitHub Copilot", () => {
    const resolved = resolveProviderConfig({
      provider: "github-copilot",
      providerAuth: {
        "github-copilot": {
          credential: "sk-or-v1-stale-openrouter-token",
          oauth: {
            accessToken: "ghu_copilot_device_token",
            tokenType: "github-device",
          },
        },
      },
    });

    expect(resolved.apiKey).toBe("ghu_copilot_device_token");
    expect(resolved.apiKeySource).toBe("settings");
    expect(resolved.runtimeReady).toBe(true);
  });

  test("normalizes saved prefixed GitHub Copilot model ids to bare chat model ids", () => {
    const resolved = resolveProviderConfig({
      provider: "github-copilot",
      model: "github-copilot/gpt-5.4",
      providerAuth: {
        "github-copilot": {
          oauth: {
            accessToken: "ghu_copilot_device_token",
            tokenType: "github-device",
          },
        },
      },
    });

    expect(resolved.model).toBe("gpt-5.4");
  });

  const promotedProviders = [
    {
      provider: "huggingface",
      credential: "hf_test_token",
      model: "huggingface/deepseek-ai/DeepSeek-R1",
      baseUrl: "https://router.huggingface.co/v1",
    },
    {
      provider: "qianfan",
      credential: "qf_test_token",
      model: "qianfan/deepseek-v3.2",
      baseUrl: "https://qianfan.baidubce.com/v2",
    },
    {
      provider: "qwen",
      credential: "qwen_test_token",
      model: "qwen/qwen3.5-plus",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    },
    {
      provider: "moonshot",
      credential: "moonshot_test_token",
      model: "moonshot/kimi-k2.5",
      baseUrl: "https://api.moonshot.ai/v1",
    },
    {
      provider: "stepfun",
      credential: "stepfun_test_token",
      model: "stepfun/step-3.5-flash",
      baseUrl: "https://api.stepfun.ai/v1",
    },
    {
      provider: "stepfun-plan",
      credential: "stepfun_plan_test_token",
      model: "stepfun-plan/step-3.5-flash",
      baseUrl: "https://api.stepfun.ai/step_plan/v1",
    },
    {
      provider: "zai",
      credential: "zai_test_token",
      model: "zai/glm-5",
      baseUrl: "https://api.z.ai/api/paas/v4",
    },
    {
      provider: "volcengine",
      credential: "volcengine_test_token",
      model: "volcengine/doubao-seed-1.6",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    },
    {
      provider: "volcengine-plan",
      credential: "volcengine_plan_test_token",
      model: "volcengine-plan/ark-code-latest",
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    },
    {
      provider: "kilocode",
      credential: "kilocode_test_token",
      model: "kilocode/kilo/auto",
      baseUrl: "https://api.kilo.ai/api/gateway",
    },
    {
      provider: "venice",
      credential: "venice_test_token",
      model: "venice/kimi-k2-5",
      baseUrl: "https://api.venice.ai/api/v1",
    },
    {
      provider: "xiaomi",
      credential: "xiaomi_test_token",
      model: "xiaomi/mimo-v2-flash",
      baseUrl: "https://api.xiaomimimo.com/v1",
    },
  ] as const;

  for (const providerCase of promotedProviders) {
    test(`resolves ${providerCase.provider} with promoted OpenAI-compatible defaults`, () => {
      const resolved = resolveProviderConfig({
        provider: providerCase.provider,
        providerAuth: {
          [providerCase.provider]: { credential: providerCase.credential },
        },
      });

      expect(resolved.providerId).toBe(providerCase.provider);
      expect(resolved.model).toBe(providerCase.model);
      expect(resolved.baseUrl).toBe(providerCase.baseUrl);
      expect(resolved.apiKey).toBe(providerCase.credential);
      expect(resolved.transport).toBe("openai-compatible");
      expect(resolved.implemented).toBe(true);
      expect(resolved.runtimeReady).toBe(true);
    });
  }

  test("resolves local Ollama defaults without a user-supplied key", () => {
    const resolved = resolveProviderConfig({
      provider: "ollama",
    });

    expect(resolved.providerId).toBe("ollama");
    expect(resolved.apiKey).toBe("ollama-local");
    expect(resolved.apiKeySource).toBe("default");
    expect(resolved.apiKeyConfigured).toBe(true);
    expect(resolved.baseUrl).toBe("http://localhost:11434/v1");
    expect(resolved.model).toBe("llama3.2");
    expect(resolved.runtimeReady).toBe(true);
  });

  test("requires a base URL and model for custom OpenAI-compatible endpoints", () => {
    const resolved = resolveProviderConfig({
      provider: "custom-openai",
      providerAuth: {
        "custom-openai": { credential: "custom-key" },
      },
    });

    expect(resolved.providerId).toBe("custom-openai");
    expect(resolved.runtimeReady).toBe(false);
    expect(resolved.missingConfiguration).toContain("base URL");
    expect(resolved.missingConfiguration).toContain("model");
    expect(getProviderNotConfiguredMessage(resolved)).toContain("configure a base URL in settings or env");
  });

  test("resolves a custom OpenAI-compatible endpoint when base URL, model, and API key are configured", () => {
    const resolved = resolveProviderConfig({
      provider: "custom-openai",
      model: "google/gemma-3-27b-it",
      baseUrl: "http://localhost:8080/v1",
      providerAuth: {
        "custom-openai": { credential: "custom-key" },
      },
    });

    expect(resolved.providerId).toBe("custom-openai");
    expect(resolved.baseUrl).toBe("http://localhost:8080/v1");
    expect(resolved.model).toBe("google/gemma-3-27b-it");
    expect(resolved.runtimeReady).toBe(true);
  });

  test("describes the expected base URL format for custom OpenAI-compatible endpoints", () => {
    expect(providerSupportsConfigurableBaseUrl("custom-openai")).toBe(true);
    expect(getProviderBaseUrlDescription("custom-openai")).toContain("http://localhost:8080/v1");
    expect(getProviderBaseUrlDescription("custom-openai")).toContain("/chat/completions");
  });

  test("keeps unsupported providers explicit instead of collapsing them to OpenRouter", () => {
    const resolved = resolveProviderConfig({
      provider: "anthropic",
    });

    expect(resolved.providerId).toBe("anthropic");
    expect(resolved.providerLabel).toBe("Anthropic");
    expect(resolved.implemented).toBe(false);
    expect(resolved.runtimeReady).toBe(false);
    expect(getProviderNotConfiguredMessage(resolved)).toContain("not implemented yet");
  });

  test("builds out cataloged providers with seeded defaults without marking them implemented", () => {
    const minimax = resolveProviderConfig({ provider: "minimax" });
    const opencodeGo = resolveProviderConfig({ provider: "opencode-go" });

    expect(minimax.implemented).toBe(false);
    expect(minimax.model).toBe("minimax/MiniMax-M2.7");
    expect(minimax.exampleModels).toContain("minimax/MiniMax-M2.7");
    expect(opencodeGo.implemented).toBe(false);
    expect(opencodeGo.model).toBe("opencode-go/kimi-k2.5");
    expect(opencodeGo.exampleModels).toEqual(["opencode-go/kimi-k2.5"]);
  });

  test("marks Azure catalog entries as manual providers with explicit base URL setup", () => {
    const resolved = resolveProviderConfig({ provider: "azure" });

    expect(providerSupportsManualCredentialEntry("azure")).toBe(true);
    expect(providerSupportsConfigurableBaseUrl("azure")).toBe(true);
    expect(resolved.authKind).toBe("api-key");
    expect(resolved.missingConfiguration).toContain("base URL");
  });

  test("keeps extra setup env vars separate from credential env vars", () => {
    const workersAi = getBuiltinProviderDefinition("cloudflare-workers-ai");
    const gitlab = getBuiltinProviderDefinition("gitlab");
    const resolved = resolveProviderConfig({ provider: "cloudflare-workers-ai" });

    expect(workersAi?.envKeys).toEqual(["CLOUDFLARE_API_KEY"]);
    expect(workersAi?.additionalEnvKeys).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(resolved.envKeyNames).toEqual(["CLOUDFLARE_API_KEY"]);
    expect(providerSupportsManualCredentialEntry(gitlab)).toBe(true);
  });

  test("lists the built-in provider catalog alongside extension providers", () => {
    const listed = listRuntimeProviders([{ id: "echo-ext", name: "Echo Extension", model: "echo", getCapabilities() { throw new Error("not used"); }, async complete() { throw new Error("not used"); }, async *stream() { return; }, isConfigured() { return true; } }]);

    expect(listed.some((provider) => provider.id === "openrouter" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "openai" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "groq" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "huggingface" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "zai" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "venice" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "xiaomi" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "echo-ext" && provider.source === "extension")).toBe(true);
  });
});