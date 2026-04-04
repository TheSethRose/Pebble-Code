import { describe, expect, test } from "bun:test";
import { getProviderSelectionAuthFollowUp } from "../src/ui/settingsFlow";

describe("settings auth follow-up routing", () => {
  test("routes unconfigured API-key providers into auth flow", () => {
    const followUp = getProviderSelectionAuthFollowUp(
      {
        provider: "openrouter",
      },
      "xiaomi",
    );

    expect(followUp).not.toBeNull();
    expect(followUp?.providerId).toBe("xiaomi");
    expect(followUp?.notice).toContain("Xiaomi");
    expect(followUp?.notice).toContain("API key");
  });

  test("routes unconfigured oauth providers into auth flow", () => {
    const followUp = getProviderSelectionAuthFollowUp(
      {
        provider: "openrouter",
      },
      "github-copilot",
    );

    expect(followUp).not.toBeNull();
    expect(followUp?.providerId).toBe("github-copilot");
    expect(followUp?.notice).toContain("OAuth");
  });

  test("does not reroute already-configured providers", () => {
    const followUp = getProviderSelectionAuthFollowUp(
      {
        provider: "venice",
        providerAuth: {
          venice: { credential: "vapi_test_token" },
        },
      },
      "venice",
    );

    expect(followUp).toBeNull();
  });

  test("does not reroute local providers with built-in defaults", () => {
    const followUp = getProviderSelectionAuthFollowUp(
      {
        provider: "ollama",
      },
      "ollama",
    );

    expect(followUp).toBeNull();
  });
});