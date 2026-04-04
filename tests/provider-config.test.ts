import { describe, expect, test } from "bun:test";
import { resolveProviderConfig } from "../src/providers/config";

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
});