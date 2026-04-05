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

  test("uses the responses API with max_output_tokens for GitHub Copilot GPT-5 requests", async () => {
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
        id: "resp_1",
        object: "response",
        created: 1,
        model: "gpt-5.4",
        output_text: "Hello from GPT-5.4",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: null,
        output: [
          {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{
              type: "output_text",
              text: "Hello from GPT-5.4",
              annotations: [],
            }],
          },
        ],
        parallel_tool_calls: true,
        temperature: null,
        tool_choice: "auto",
        tools: [],
        usage: {
          input_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 3,
          output_tokens_details: { reasoning_tokens: 0 },
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
    expect(requests[1]?.url).toBe("https://api.individual.githubcopilot.com/responses");
    expect(requestBody.max_output_tokens).toBe(123);
    expect(requestBody.max_completion_tokens).toBeUndefined();
    expect(requestBody.max_tokens).toBeUndefined();
  });

  test("preserves assistant tool calls and tool outputs in follow-up Copilot GPT-5 responses requests", async () => {
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
        id: "resp_2",
        object: "response",
        created: 1,
        model: "gpt-5.4-mini",
        output_text: "Here is the workspace overview.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: null,
        output: [
          {
            id: "msg_2",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{
              type: "output_text",
              text: "Here is the workspace overview.",
              annotations: [],
            }],
          },
        ],
        parallel_tool_calls: true,
        temperature: null,
        tool_choice: "auto",
        tools: [],
        usage: {
          input_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 3,
          output_tokens_details: { reasoning_tokens: 0 },
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
        model: "gpt-5.4-mini",
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

    const response = await provider.complete([
      { role: "user", content: "Give me an overview of the workspace" },
      {
        role: "assistant",
        content: "I'll inspect the workspace first.",
        metadata: {
          toolCalls: [{
            id: "call_workspace_read_1",
            name: "WorkspaceRead",
            input: {
              action: "project_structure",
              path: ".",
            },
          }],
        },
      },
      {
        role: "tool",
        content: "src/\nREADME.md",
        toolCallId: "call_workspace_read_1",
        toolName: "WorkspaceRead",
      },
    ]);

    expect(response.text).toBe("Here is the workspace overview.");
    const requestBody = JSON.parse(requests[1]?.body ?? "{}");
    expect(requests[1]?.url).toBe("https://api.individual.githubcopilot.com/responses");
    expect(requestBody.input).toHaveLength(4);
    expect(requestBody.input[1]).toMatchObject({
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "I'll inspect the workspace first.",
        },
      ],
    });
    expect(requestBody.input[2]).toMatchObject({
      type: "function_call",
      call_id: "call_workspace_read_1",
      name: "WorkspaceRead",
      arguments: JSON.stringify({ action: "project_structure", path: "." }),
    });
    expect(requestBody.input[2].id).toBeUndefined();
    expect(requestBody.input[3]).toMatchObject({
      type: "function_call_output",
      call_id: "call_workspace_read_1",
      output: "src/\nREADME.md",
    });
  });

  test("normalizes oversized Copilot GPT-5 call ids in follow-up responses history", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
    const longToolCallId = `call_${"workspace_read_".repeat(25)}`;

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
        id: "resp_2b",
        object: "response",
        created: 1,
        model: "gpt-5.4-mini",
        output_text: "Here is the workspace overview.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: null,
        output: [
          {
            id: "msg_2b",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{
              type: "output_text",
              text: "Here is the workspace overview.",
              annotations: [],
            }],
          },
        ],
        parallel_tool_calls: true,
        temperature: null,
        tool_choice: "auto",
        tools: [],
        usage: {
          input_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 3,
          output_tokens_details: { reasoning_tokens: 0 },
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
        model: "gpt-5.4-mini",
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

    await provider.complete([
      { role: "user", content: "Give me an overview of the workspace" },
      {
        role: "assistant",
        content: "I'll inspect the workspace first.",
        metadata: {
          toolCalls: [{
            id: longToolCallId,
            name: "WorkspaceRead",
            input: {
              action: "project_structure",
              path: ".",
            },
          }],
        },
      },
      {
        role: "tool",
        content: "src/\nREADME.md",
        toolCallId: longToolCallId,
        toolName: "WorkspaceRead",
      },
    ]);

    const requestBody = JSON.parse(requests[1]?.body ?? "{}");
    expect(requestBody.input[2]).toMatchObject({
      type: "function_call",
      name: "WorkspaceRead",
      arguments: JSON.stringify({ action: "project_structure", path: "." }),
    });
    expect(requestBody.input[3]).toMatchObject({
      type: "function_call_output",
      output: "src/\nREADME.md",
    });
    expect(requestBody.input[2].call_id).toMatch(/^call_[a-f0-9]{24}$/);
    expect(requestBody.input[2].call_id.length).toBeLessThanOrEqual(64);
    expect(requestBody.input[3].call_id).toBe(requestBody.input[2].call_id);
  });

  test("streams GitHub Copilot GPT-5 responses through the responses API", async () => {
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
        'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_3","object":"response","created_at":1,"model":"gpt-5.4-mini","output":[],"output_text":"","error":null,"incomplete_details":null,"instructions":null,"metadata":null,"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":0,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":1}}}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello","content_index":0,"item_id":"msg_3","output_index":0,"sequence_number":2}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_3","object":"response","created_at":1,"model":"gpt-5.4-mini","output":[],"output_text":"Hello","error":null,"incomplete_details":null,"instructions":null,"metadata":null,"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}\n\n',
        'data: [DONE]\n\n',
      ].join("");

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
        provider: "github-copilot",
        model: "gpt-5.4-mini",
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

    const chunks = [] as Array<{ textDelta?: string; done: boolean; stopReason?: unknown }>;
    for await (const chunk of provider.stream([{ role: "user", content: "Hello" }])) {
      chunks.push({
        textDelta: chunk.textDelta,
        done: chunk.done,
        stopReason: chunk.metadata?.stopReason,
      });
    }

    expect(chunks).toEqual([
      { textDelta: "Hello", done: false, stopReason: undefined },
      { textDelta: undefined, done: true, stopReason: "end_turn" },
    ]);
    expect(requests[1]?.url).toBe("https://api.individual.githubcopilot.com/responses");
  });

  test("surfaces streamed Copilot GPT-5 function calls using call_id instead of fc item ids", async () => {
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
        'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_4","object":"response","created_at":1,"model":"gpt-5.4-mini","output":[],"output_text":"","error":null,"incomplete_details":null,"instructions":null,"metadata":null,"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":0,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":1}}}\n\n',
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"sequence_number":2,"item":{"id":"fc_123","type":"function_call","call_id":"call_workspace_read_1","name":"WorkspaceRead","arguments":"","status":"in_progress"}}\n\n',
        'event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","arguments":"{\\"action\\":\\"project_structure\\",\\"path\\":\\".\\"}","item_id":"fc_123","name":"WorkspaceRead","output_index":0,"sequence_number":3}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_4","object":"response","created_at":1,"model":"gpt-5.4-mini","output":[],"output_text":"","error":null,"incomplete_details":null,"instructions":null,"metadata":null,"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":0,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":1}}}\n\n',
        'data: [DONE]\n\n',
      ].join("");

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
        provider: "github-copilot",
        model: "gpt-5.4-mini",
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

    const chunks = [] as Array<{ toolCall?: { id: string; name: string; input: unknown }; done: boolean; stopReason?: unknown }>;
    for await (const chunk of provider.stream([{ role: "user", content: "Inspect the workspace" }])) {
      chunks.push({
        toolCall: chunk.toolCall,
        done: chunk.done,
        stopReason: chunk.metadata?.stopReason,
      });
    }

    expect(chunks).toEqual([
      {
        toolCall: {
          id: "call_workspace_read_1",
          name: "WorkspaceRead",
          input: { action: "project_structure", path: "." },
        },
        done: false,
        stopReason: undefined,
      },
      {
        toolCall: undefined,
        done: true,
        stopReason: "tool_use",
      },
    ]);
    expect(requests[1]?.url).toBe("https://api.individual.githubcopilot.com/responses");
  });

  test("waits for a usable streamed tool name and decodes double-encoded Copilot GPT-5 tool input", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const longToolCallId = `call_${"workspace_read_".repeat(25)}`;
    const doubleEncodedArguments = JSON.stringify(JSON.stringify({
      action: "project_structure",
      path: ".",
    }));

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
        'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_5","object":"response","created_at":1,"model":"gpt-5.4-mini","output":[],"output_text":"","error":null,"incomplete_details":null,"instructions":null,"metadata":null,"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":0,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":1}}}\n\n',
        `event: response.function_call_arguments.done\ndata: ${JSON.stringify({
          type: "response.function_call_arguments.done",
          arguments: doubleEncodedArguments,
          item_id: "fc_456",
          output_index: 0,
          sequence_number: 2,
        })}\n\n`,
        `event: response.output_item.done\ndata: ${JSON.stringify({
          type: "response.output_item.done",
          output_index: 0,
          sequence_number: 3,
          item: {
            id: "fc_456",
            type: "function_call",
            call_id: longToolCallId,
            name: "WorkspaceRead",
            arguments: doubleEncodedArguments,
            status: "completed",
          },
        })}\n\n`,
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_5","object":"response","created_at":1,"model":"gpt-5.4-mini","output":[],"output_text":"","error":null,"incomplete_details":null,"instructions":null,"metadata":null,"parallel_tool_calls":true,"temperature":null,"tool_choice":"auto","tools":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":0,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":1}}}\n\n',
        'data: [DONE]\n\n',
      ].join("");

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = createPrimaryProvider({
      settings: {
        provider: "github-copilot",
        model: "gpt-5.4-mini",
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

    const chunks = [] as Array<{ toolCall?: { id: string; name: string; input: unknown }; done: boolean; stopReason?: unknown }>;
    for await (const chunk of provider.stream([{ role: "user", content: "Inspect the workspace" }])) {
      chunks.push({
        toolCall: chunk.toolCall,
        done: chunk.done,
        stopReason: chunk.metadata?.stopReason,
      });
    }

    expect(chunks).toEqual([
      {
        toolCall: {
          id: expect.stringMatching(/^call_[a-f0-9]{24}$/),
          name: "WorkspaceRead",
          input: { action: "project_structure", path: "." },
        },
        done: false,
        stopReason: undefined,
      },
      {
        toolCall: undefined,
        done: true,
        stopReason: "tool_use",
      },
    ]);
    expect((chunks[0]?.toolCall?.id ?? "").length).toBeLessThanOrEqual(64);
    expect(requests[1]?.url).toBe("https://api.individual.githubcopilot.com/responses");
  });
});
