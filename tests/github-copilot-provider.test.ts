import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrimaryProvider } from "../src/providers/primary/index";
import { getGitHubCopilotDebugLogPath } from "../src/providers/githubCopilotDebug";

const previousFetch = globalThis.fetch;
const previousPebbleHome = process.env.PEBBLE_HOME;
const tempPebbleHomes: string[] = [];

afterEach(() => {
  globalThis.fetch = previousFetch;

  while (tempPebbleHomes.length > 0) {
    const dir = tempPebbleHomes.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  if (previousPebbleHome === undefined) {
    delete process.env.PEBBLE_HOME;
  } else {
    process.env.PEBBLE_HOME = previousPebbleHome;
  }
});

describe("GitHub Copilot provider runtime", () => {
  test("exchanges the saved GitHub token before non-streaming completions", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      requests.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url === "https://api.github.com/copilot_internal/v2/token") {
        return new Response(JSON.stringify({
          token: "copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
          expires_at: Math.floor((Date.now() + 30 * 60_000) / 1000),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      expect(url).toBe("https://api.individual.githubcopilot.com/chat/completions");
      return new Response(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from Copilot" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
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
    });

    const response = await provider.complete([{ role: "user", content: "Hello" }]);

    expect(response.text).toBe("Hello from Copilot");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get("Authorization")).toBe("token ghu_saved_device_token");
    expect(requests[0]?.headers.get("Editor-Version")).toBeDefined();
    expect(requests[0]?.headers.get("X-Github-Api-Version")).toBeDefined();
    expect(requests[1]?.headers.get("Authorization")).toBe(
      "Bearer copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
    );
    expect(requests[1]?.headers.get("Openai-Intent")).toBe("conversation-edits");
    expect(requests[1]?.body).toContain('"model":"gpt-4o"');
  });

  test("prefers the saved OAuth session over a stale saved credential during token exchange", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      requests.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url === "https://api.github.com/copilot_internal/v2/token") {
        return new Response(JSON.stringify({
          token: "copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
          expires_at: Math.floor((Date.now() + 30 * 60_000) / 1000),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      expect(url).toBe("https://api.individual.githubcopilot.com/chat/completions");
      return new Response(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from Copilot" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
        provider: "github-copilot",
        providerAuth: {
          "github-copilot": {
            credential: "sk-or-v1-stale-openrouter-token",
            oauth: {
              accessToken: "ghu_saved_device_token",
              tokenType: "github-device",
            },
          },
        },
      },
    });

    const response = await provider.complete([{ role: "user", content: "Hello" }]);

    expect(response.text).toBe("Hello from Copilot");
    expect(requests[0]?.headers.get("Authorization")).toBe("token ghu_saved_device_token");
    expect(requests[0]?.headers.get("Authorization")).not.toContain("sk-or-v1");
  });

  test("streams GitHub Copilot responses after token exchange", async () => {
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

      const body = [
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
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
    });

    const chunks = [] as Array<{ textDelta?: string; done: boolean }>;
    for await (const chunk of provider.stream([{ role: "user", content: "Hello" }])) {
      chunks.push({ textDelta: chunk.textDelta, done: chunk.done });
    }

    expect(chunks).toEqual([
      { textDelta: "Hello", done: false },
      { textDelta: undefined, done: true },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe("https://api.individual.githubcopilot.com/chat/completions");
    expect(requests[1]?.headers.get("Authorization")).toBe(
      "Bearer copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
    );
  });

  test("surfaces a helpful message when Copilot token exchange is unauthorized", async () => {
    const pebbleHome = mkdtempSync(join(tmpdir(), "pebble-copilot-debug-"));
    tempPebbleHomes.push(pebbleHome);
    process.env.PEBBLE_HOME = pebbleHome;

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

      expect(url).toBe("https://api.github.com/copilot_internal/v2/token");
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
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
    });

    await expect(provider.complete([{ role: "user", content: "Hello" }])).rejects.toThrow(
      `Copilot token exchange failed: HTTP 401. See ${getGitHubCopilotDebugLogPath()} for details, then run /login github-copilot again to refresh your GitHub session.`,
    );

    const logPath = getGitHubCopilotDebugLogPath();
    expect(existsSync(logPath)).toBe(true);

    const logContents = readFileSync(logPath, "utf-8");
    expect(logContents).toContain("prepare_client_config");
    expect(logContents).toContain("runtime_token_exchange_response");
    expect(logContents).toContain('"status":401');
    expect(logContents).toContain("Unauthorized");
    expect(logContents).not.toContain("ghu_saved_device_token");
  });

  test("uses max_completion_tokens for GitHub Copilot GPT-5 requests when maxTokens is provided", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      requests.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url === "https://api.github.com/copilot_internal/v2/token") {
        return new Response(JSON.stringify({
          token: "copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
          expires_at: Math.floor((Date.now() + 30 * 60_000) / 1000),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-5.4",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from GPT-5.4" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
        provider: "github-copilot",
        model: "gpt-5.4",
        providerAuth: {
          "github-copilot": {
            oauth: {
              accessToken: "ghu_saved_device_token",
              tokenType: "github-device",
            },
          },
        },
      },
    });

    const response = await provider.complete([{ role: "user", content: "Hello" }], {
      maxTokens: 123,
    });

    expect(response.text).toBe("Hello from GPT-5.4");
    const requestBody = JSON.parse(requests[1]?.body ?? "{}");
    expect(requestBody.model).toBe("gpt-5.4");
    expect(requestBody.max_completion_tokens).toBe(123);
    expect(requestBody.max_tokens).toBeUndefined();
  });
});
