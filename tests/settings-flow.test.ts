import { describe, expect, test } from "bun:test";
import {
  getProviderAuthStatus,
  getProviderSelectionAuthFollowUp,
} from "../src/ui/settingsFlow";

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

  test("reports stored credentials as configured auth", () => {
    const status = getProviderAuthStatus(
      {
        provider: "venice",
        providerAuth: {
          venice: { credential: "vapi_test_token" },
        },
      },
      "venice",
    );

    expect(status.isConfigured).toBe(true);
    expect(status.source).toBe("settings");
    expect(status.credential).toBe("vapi_test_token");
  });

  test("reports saved OAuth sessions as configured auth", () => {
    const status = getProviderAuthStatus(
      {
        provider: "github-copilot",
        providerAuth: {
          "github-copilot": {
            oauth: {
              accessToken: "ghu_saved_device_token",
              tokenType: "github-device",
            },
          },
        },
      },
      "github-copilot",
    );

    expect(status.isConfigured).toBe(true);
    expect(status.source).toBe("settings");
    expect(status.credential).toBe("ghu_saved_device_token");
  });

  test("reports oauth providers without a token as not configured", () => {
    const previousGithubCopilotToken = process.env.GITHUB_COPILOT_TOKEN;
    const previousCopilotToken = process.env.COPILOT_TOKEN;
    delete process.env.GITHUB_COPILOT_TOKEN;
    delete process.env.COPILOT_TOKEN;

    try {
      const status = getProviderAuthStatus(
        {
          provider: "openrouter",
        },
        "github-copilot",
      );

      expect(status.isConfigured).toBe(false);
      expect(status.source).toBe("none");
    } finally {
      if (previousGithubCopilotToken === undefined) {
        delete process.env.GITHUB_COPILOT_TOKEN;
      } else {
        process.env.GITHUB_COPILOT_TOKEN = previousGithubCopilotToken;
      }

      if (previousCopilotToken === undefined) {
        delete process.env.COPILOT_TOKEN;
      } else {
        process.env.COPILOT_TOKEN = previousCopilotToken;
      }
    }
  });

  test("treats local providers with built-in defaults as configured auth", () => {
    const status = getProviderAuthStatus(
      {
        provider: "ollama",
      },
      "ollama",
    );

    expect(status.isConfigured).toBe(true);
    expect(status.source).toBe("default");
    expect(status.credential).toBe("ollama-local");
  });
});