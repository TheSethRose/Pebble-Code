import { afterEach, describe, expect, test } from "bun:test";
import { buildCopilotRequestHeaders } from "../src/constants/githubCopilot";
import {
  fetchProviderModels,
  parseProviderModelsResponse,
} from "../src/ui/providerModels";

const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
});

describe("provider model fetching", () => {
  test("parses both OpenAI-style and Copilot-style model payloads", () => {
    expect(parseProviderModelsResponse({
      providerId: "openai",
      value: {
        data: [
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-4o", name: "Duplicate GPT-4o" },
        ],
      },
    })).toEqual([{ id: "gpt-4o", name: "GPT-4o" }]);

    expect(parseProviderModelsResponse({
      providerId: "github-copilot",
      value: {
        models: [
          { id: "gpt-5", name: "GPT-5" },
          "gpt-5-codex",
        ],
      },
    })).toEqual([
      { id: "github-copilot/gpt-5", name: "GPT-5" },
      { id: "github-copilot/gpt-5-codex" },
    ]);
  });

  test("uses Copilot runtime token exchange before fetching the model catalog", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      requests.push({ url, headers: new Headers(init?.headers) });

      if (url === "https://api.github.com/copilot_internal/v2/token") {
        return new Response(JSON.stringify({
          token: "copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
          expires_at: Math.floor((Date.now() + 30 * 60_000) / 1000),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      expect(url).toBe("https://api.individual.githubcopilot.com/models");
      return new Response(JSON.stringify({
        models: [
          { id: "gpt-5", name: "GPT-5" },
          { id: "gpt-5-codex", name: "GPT-5-Codex" },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const models = await fetchProviderModels({
      providerId: "github-copilot",
      apiKey: "ghu_saved_device_token",
      baseUrl: "https://api.individual.githubcopilot.com",
      requestHeaders: buildCopilotRequestHeaders(),
      fetchImpl: globalThis.fetch,
    });

    expect(models).toEqual([
      { id: "github-copilot/gpt-5", name: "GPT-5" },
      { id: "github-copilot/gpt-5-codex", name: "GPT-5-Codex" },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get("Authorization")).toBe("token ghu_saved_device_token");
    expect(requests[1]?.headers.get("Authorization")).toBe(
      "Bearer copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
    );
    expect(requests[1]?.headers.get("Openai-Intent")).toBe("conversation-edits");
  });
});