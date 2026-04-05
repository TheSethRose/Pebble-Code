import { afterEach, describe, expect, test } from "bun:test";
import { runSettingsProviderLogin } from "../src/ui/providerLogin";
import type { Settings } from "../src/runtime/config";

const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
});

function createSettings(provider: string): Settings {
  return {
    provider,
    permissionMode: "always-ask",
    telemetryEnabled: false,
  };
}

describe("settings provider login runner", () => {
  test("runs GitHub Copilot device login and persists the OAuth session into settings", async () => {
    const lines: string[] = [];
    const openedUrls: string[] = [];
    let fetchCall = 0;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCall += 1;
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      requests.push({ url, init });

      if (fetchCall === 1) {
        expect(url).toBe("https://github.com/login/device/code");
        return new Response(JSON.stringify({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      expect(url).toBe("https://github.com/login/oauth/access_token");
      return new Response(JSON.stringify({
        access_token: "ghu_settings_login_token",
        token_type: "bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await runSettingsProviderLogin({
      providerId: "github-copilot",
      settings: createSettings("openrouter"),
      fetchImpl: globalThis.fetch,
      writeLine: (line) => lines.push(line),
      openExternalUrl: async (url) => {
        openedUrls.push(url);
        return true;
      },
    });

    expect(result.message).toContain("Saved OAuth session for github-copilot");
    expect(lines.join(" ")).toContain("GitHub Copilot device login");
    expect(lines.join(" ")).toContain("Opened browser:");
    expect(lines.join(" ")).toContain("ABCD-EFGH");
    expect(openedUrls).toEqual(["https://github.com/login/device"]);
    expect(result.nextSettings.provider).toBe("github-copilot");
    expect(result.nextSettings.model).toBe("github-copilot/gpt-4o");
    expect(result.nextSettings.baseUrl).toBe("https://api.individual.githubcopilot.com");
    expect(result.nextSettings.providerAuth?.["github-copilot"]?.oauth?.accessToken).toBe(
      "ghu_settings_login_token",
    );
    expect(result.nextSettings.providerAuth?.["github-copilot"]?.oauth?.tokenType).toBe("github-device");

    const deviceRequest = requests[0];
    expect(deviceRequest?.init?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(deviceRequest?.init?.body).toBe(JSON.stringify({
      client_id: "01ab8ac9400c4e429b23",
      scope: "read:user user:email repo workflow",
    }));

    const tokenRequest = requests[1];
    expect(tokenRequest?.init?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(tokenRequest?.init?.body).toBe(JSON.stringify({
      client_id: "01ab8ac9400c4e429b23",
      device_code: "device-code",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }));
  });

  test("switching to GitHub Copilot login does not carry over the previous provider credential", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

      if (url === "https://github.com/login/device/code") {
        return new Response(JSON.stringify({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        access_token: "ghu_settings_login_token",
        token_type: "bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await runSettingsProviderLogin({
      providerId: "github-copilot",
      settings: {
        ...createSettings("openrouter"),
        apiKey: "sk-or-v1-openrouter-token",
        providerAuth: {
          openrouter: {
            credential: "sk-or-v1-openrouter-token",
          },
        },
      },
      fetchImpl: globalThis.fetch,
    });

    expect(result.nextSettings.provider).toBe("github-copilot");
    expect(result.nextSettings.apiKey).toBe("ghu_settings_login_token");
    expect(result.nextSettings.providerAuth?.openrouter?.credential).toBe("sk-or-v1-openrouter-token");
    expect(result.nextSettings.providerAuth?.["github-copilot"]?.credential).toBeUndefined();
    expect(result.nextSettings.providerAuth?.["github-copilot"]?.oauth?.accessToken).toBe("ghu_settings_login_token");
  });

  test("throws for providers without automatic settings login support", async () => {
    await expect(runSettingsProviderLogin({
      providerId: "openai-codex",
      settings: createSettings("openai-codex"),
    })).rejects.toThrow("Automatic settings login is not available for openai-codex yet.");
  });
});