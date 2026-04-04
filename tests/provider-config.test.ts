import { describe, expect, test } from "bun:test";
import {
  getProviderNotConfiguredMessage,
  resolveProviderConfig,
} from "../src/providers/config";
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
      apiKey: "saved-key",
    });

    expect(resolved.model).toBe("anthropic/claude-sonnet-4.6");
    expect(resolved.baseUrl).toBe("https://example.com/v1");
    expect(resolved.apiKey).toBe("saved-key");
    expect(resolved.apiKeySource).toBe("settings");
  });

  test("resolves OpenAI config with provider-specific defaults", () => {
    const resolved = resolveProviderConfig({
      provider: "openai",
      apiKey: "sk-openai-test",
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

  test("lists the built-in provider catalog alongside extension providers", () => {
    const listed = listRuntimeProviders([{ id: "echo-ext", name: "Echo Extension", model: "echo", getCapabilities() { throw new Error("not used"); }, async complete() { throw new Error("not used"); }, async *stream() { return; }, isConfigured() { return true; } }]);

    expect(listed.some((provider) => provider.id === "openrouter" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "openai" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "groq" && provider.source === "builtin")).toBe(true);
    expect(listed.some((provider) => provider.id === "echo-ext" && provider.source === "extension")).toBe(true);
  });
});