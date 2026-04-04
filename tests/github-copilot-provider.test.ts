import { afterEach, describe, expect, test } from "bun:test";
import { createPrimaryProvider } from "../src/providers/primary/index";

const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
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
        model: "github-copilot/gpt-4o",
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
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer ghu_saved_device_token");
    expect(requests[0]?.headers.get("Editor-Version")).toBeDefined();
    expect(requests[1]?.headers.get("Authorization")).toBe(
      "Bearer copilot-runtime-token;proxy-ep=proxy.individual.githubcopilot.com",
    );
    expect(requests[1]?.headers.get("Openai-Intent")).toBe("conversation-edits");
    expect(requests[1]?.body).toContain("github-copilot/gpt-4o");
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
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"github-copilot/gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"github-copilot/gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
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
});
