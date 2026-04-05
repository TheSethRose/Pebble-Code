import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { QueryEngine, normalizeProviderToolInputSchema } from "../src/engine/QueryEngine";
import type { Message } from "../src/engine/types";
import { PermissionManager } from "../src/runtime/permissionManager";
import type { Provider, ProviderCapabilities, ProviderOptions, ProviderResponse, StreamChunk } from "../src/providers/types";
import { FileEditTool } from "../src/tools/FileEditTool";
import { FileReadTool } from "../src/tools/FileReadTool";
import type { Tool } from "../src/tools/Tool";
import { WorkspaceReadTool } from "../src/tools/WorkspaceReadTool";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

class StubProvider implements Provider {
  readonly id = "stub";
  readonly name = "Stub Provider";
  readonly model = "stub-model";

  constructor(
    private readonly response: ProviderResponse,
    private readonly streamChunks: StreamChunk[] = [],
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  completeCalls = 0;

  async complete(_messages: Message[], _options?: ProviderOptions): Promise<ProviderResponse> {
    this.completeCalls += 1;
    return this.response;
  }

  async *stream(_messages: Message[], _options?: ProviderOptions): AsyncIterable<StreamChunk> {
    for (const chunk of this.streamChunks) {
      yield chunk;
    }
  }

  isConfigured(): boolean {
    return true;
  }
}

class ScriptedProvider implements Provider {
  readonly id = "scripted";
  readonly name = "Scripted Provider";
  readonly model = "scripted-model";

  completeCalls: Message[][] = [];

  constructor(
    private readonly onComplete: (messages: Message[], callNumber: number) => Promise<ProviderResponse> | ProviderResponse,
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: false,
      toolUse: true,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  async complete(messages: Message[], _options?: ProviderOptions): Promise<ProviderResponse> {
    this.completeCalls.push(messages.map((message) => ({ ...message })));
    return this.onComplete(messages, this.completeCalls.length);
  }

  async *stream(_messages: Message[], _options?: ProviderOptions): AsyncIterable<StreamChunk> {
    throw new Error("Streaming not implemented for ScriptedProvider");
  }

  isConfigured(): boolean {
    return true;
  }
}

describe("QueryEngine provider error handling", () => {
  test("normalizes discriminated-union tool schemas into a flat top-level object schema for providers", async () => {
    const provider = new StubProvider({
      text: "Done",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    let capturedTools: ProviderOptions["tools"];
    provider.complete = async (_messages: Message[], options?: ProviderOptions): Promise<ProviderResponse> => {
      capturedTools = options?.tools;
      return {
        text: "Done",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    };

    const engine = new QueryEngine({
      provider,
      tools: [new WorkspaceReadTool()],
    });

    const result = await engine.process([{ role: "user", content: "Inspect the repo" }]);

    expect(result.success).toBe(true);
    const workspaceReadTool = capturedTools?.find((tool) => tool.name === "WorkspaceRead");
    expect(workspaceReadTool).toBeDefined();
    expect(workspaceReadTool?.inputSchema.type).toBe("object");
    expect(workspaceReadTool?.inputSchema.anyOf).toBeUndefined();
    expect(workspaceReadTool?.inputSchema.oneOf).toBeUndefined();
    expect(workspaceReadTool?.inputSchema.allOf).toBeUndefined();
    expect(workspaceReadTool?.inputSchema.properties).toMatchObject({
      action: {
        type: "string",
        enum: expect.arrayContaining(["read_file", "list_directory", "glob", "grep"]),
      },
    });
  });

  test("leaves plain object schemas unchanged when normalizing provider tool schemas", () => {
    const original = {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    } as const;

    expect(normalizeProviderToolInputSchema(original)).toEqual(original);
  });

  test("stops immediately when the provider returns an error stop reason", async () => {
    const provider = new StubProvider({
      text: "Provider error: 401 User not found.",
      toolCalls: [],
      stopReason: "error",
      usage: { inputTokens: 12, outputTokens: 3 },
    });

    const engine = new QueryEngine({
      provider,
      tools: [],
      maxTurns: 50,
    });

    const result = await engine.process([{ role: "user", content: "Hello" }]);

    expect(provider.completeCalls).toBe(1);
    expect(result.state).toBe("error");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Provider error: 401 User not found.");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      content: "Provider error: 401 User not found.",
    });
  });

  test("streaming mode emits an error and finishes when the provider reports an error stop reason", async () => {
    const provider = new StubProvider(
      {
        text: "unused",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      [
        {
          textDelta: "Provider error: 401 User not found.",
          done: true,
          metadata: { stopReason: "error" },
        },
      ],
    );

    const engine = new QueryEngine({
      provider,
      tools: [],
    });

    const events = [] as Array<{ type: string; data: unknown }>;
    for await (const event of engine.stream([{ role: "user", content: "Hello" }])) {
      events.push({ type: event.type, data: event.data });
    }

    expect(events).toEqual([
      { type: "progress", data: { turn: 1 } },
      { type: "text_delta", data: { delta: "Provider error: 401 User not found." } },
      { type: "error", data: { message: "Provider error: 401 User not found." } },
      {
        type: "done",
        data: { reason: "error", usage: { inputTokens: 0, outputTokens: 0 } },
      },
    ]);
  });
});

describe("QueryEngine integration flows", () => {
  test("completes a real multi-turn FileRead/FileEdit workflow", async () => {
    const projectDir = createTempDir("pebble-engine-tool-loop-");
    const targetFile = join(projectDir, "notes.txt");
    writeFileSync(targetFile, "alpha\nbeta\n", "utf-8");

    const provider = new ScriptedProvider((messages, callNumber) => {
      if (callNumber === 1) {
        expect(messages).toEqual([{ role: "user", content: "Change beta to gamma in notes.txt" }]);

        return {
          text: "I'll inspect the file first.",
          toolCalls: [
            {
              id: "read-1",
              name: "FileRead",
              input: { file_path: "notes.txt" },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 6 },
        };
      }

      if (callNumber === 2) {
        const readResult = messages.at(-1);
        expect(readResult).toMatchObject({
          role: "tool",
          toolName: "FileRead",
          content: "alpha\nbeta\n",
          metadata: { success: true },
        });

        return {
          text: "Now I'll update it.",
          toolCalls: [
            {
              id: "edit-1",
              name: "FileEdit",
              input: {
                file_path: "notes.txt",
                old_string: "beta",
                new_string: "gamma",
              },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 12, outputTokens: 7 },
        };
      }

      if (callNumber === 3) {
        const editResult = messages.at(-1);
        expect(editResult).toMatchObject({
          role: "tool",
          toolName: "FileEdit",
          metadata: { success: true },
        });
        expect(editResult?.content).toContain("Successfully replaced 1 occurrence(s) in notes.txt");

        return {
          text: "Updated notes.txt from beta to gamma.",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 8, outputTokens: 6 },
        };
      }

      throw new Error(`Unexpected complete call ${callNumber}`);
    });

    const toolExecutions: Array<{ name: string; input: unknown }> = [];
    const engine = new QueryEngine({
      provider,
      tools: [new FileReadTool(), new FileEditTool()],
      cwd: projectDir,
      onToolExecute: (name, input) => toolExecutions.push({ name, input }),
    });

    const result = await engine.process([{ role: "user", content: "Change beta to gamma in notes.txt" }]);

    expect(result.success).toBe(true);
    expect(result.state).toBe("success");
    expect(provider.completeCalls).toHaveLength(3);
    expect(toolExecutions).toEqual([
      { name: "FileRead", input: { file_path: "notes.txt" } },
      {
        name: "FileEdit",
        input: {
          file_path: "notes.txt",
          old_string: "beta",
          new_string: "gamma",
        },
      },
    ]);
    expect(readFileSync(targetFile, "utf-8")).toBe("alpha\ngamma\n");
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Updated notes.txt from beta to gamma.",
    });
  });

  test("surfaces permission denials back into the tool loop", async () => {
    const projectDir = createTempDir("pebble-engine-permission-");
    const packageJsonPath = join(projectDir, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ name: "demo" }, null, 2), "utf-8");

    const provider = new ScriptedProvider((messages, callNumber) => {
      if (callNumber === 1) {
        return {
          text: "I'll update package.json.",
          toolCalls: [
            {
              id: "edit-package",
              name: "FileEdit",
              input: {
                file_path: "package.json",
                old_string: '"demo"',
                new_string: '"renamed-demo"',
              },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 6, outputTokens: 5 },
        };
      }

      if (callNumber === 2) {
        const denialMessage = messages.at(-1);
        expect(denialMessage).toMatchObject({
          role: "tool",
          toolName: "FileEdit",
        });
        expect(denialMessage?.content).toContain("Tool execution denied: Restricted mode");

        return {
          text: "I couldn't update package.json because permission was denied.",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 4, outputTokens: 8 },
        };
      }

      throw new Error(`Unexpected complete call ${callNumber}`);
    });

    const events: string[] = [];
    const engine = new QueryEngine({
      provider,
      tools: [new FileEditTool()],
      cwd: projectDir,
      permissionManager: new PermissionManager({
        mode: "restricted",
        projectRoot: projectDir,
      }),
      onEvent: (event) => events.push(event.type),
    });

    const result = await engine.process([{ role: "user", content: "Rename the package" }]);

    expect(result.success).toBe(true);
    expect(result.state).toBe("success");
    expect(events).toContain("permission_denied");
    expect(readFileSync(packageJsonPath, "utf-8")).toContain('"demo"');
    expect(readFileSync(packageJsonPath, "utf-8")).not.toContain('"renamed-demo"');
    expect(result.messages.at(-2)).toMatchObject({
      role: "tool",
      toolName: "FileEdit",
      content: "Tool execution denied: Restricted mode",
    });
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "I couldn't update package.json because permission was denied.",
    });
  });

  test("resolvePermission callback is invoked when PermissionManager returns ask", async () => {
    const projectDir = createTempDir("pebble-engine-resolve-perm-");
    writeFileSync(join(projectDir, "package.json"), '{"name":"demo"}', "utf-8");

    const decisions: string[] = [];

    const provider = new ScriptedProvider(async (_msgs, callNum) => {
      if (callNum === 1) {
        return {
          text: "",
          toolCalls: [
            {
              id: "tc-perm-1",
              name: "FileEdit",
              input: {
                file_path: join(projectDir, "package.json"),
                old_string: '"name":"demo"',
                new_string: '"name":"updated"',
              },
            },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      }
      return {
        text: "File updated successfully.",
        toolCalls: [],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 30, outputTokens: 10 },
      };
    });

    const engine = new QueryEngine({
      provider,
      tools: [new FileEditTool()],
      maxTurns: 5,
      cwd: projectDir,
      permissionManager: new PermissionManager({
        mode: "always-ask",
        projectRoot: projectDir,
      }),
      resolvePermission: async (request) => {
        decisions.push(`${request.toolName}:${request.approvalMessage}`);
        return "allow";
      },
    });

    const result = await engine.process([{ role: "user", content: "update package.json" }]);

    expect(result.success).toBe(true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toContain("FileEdit");
    expect(readFileSync(join(projectDir, "package.json"), "utf-8")).toContain('"name":"updated"');
  });

  test("resolvePermission deny prevents tool execution", async () => {
    const projectDir = createTempDir("pebble-engine-resolve-deny-");
    writeFileSync(join(projectDir, "package.json"), '{"name":"original"}', "utf-8");

    const provider = new ScriptedProvider(async (_msgs, callNum) => {
      if (callNum === 1) {
        return {
          text: "",
          toolCalls: [
            {
              id: "tc-deny-1",
              name: "FileEdit",
              input: {
                file_path: join(projectDir, "package.json"),
                old_string: '"name":"original"',
                new_string: '"name":"modified"',
              },
            },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      }
      return {
        text: "User denied the edit.",
        toolCalls: [],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 30, outputTokens: 10 },
      };
    });

    const engine = new QueryEngine({
      provider,
      tools: [new FileEditTool()],
      maxTurns: 5,
      cwd: projectDir,
      permissionManager: new PermissionManager({
        mode: "always-ask",
        projectRoot: projectDir,
      }),
      resolvePermission: async () => "deny",
    });

    const result = await engine.process([{ role: "user", content: "edit package.json" }]);

    expect(result.success).toBe(true);
    expect(readFileSync(join(projectDir, "package.json"), "utf-8")).toContain('"name":"original"');
  });

  test("allow-session decision is reused for later risky tool calls in the same engine session", async () => {
    const projectDir = createTempDir("pebble-engine-resolve-session-");
    writeFileSync(join(projectDir, "package.json"), '{"name":"original"}', "utf-8");

    let permissionPrompts = 0;
    const provider = new ScriptedProvider(async (_msgs, callNum) => {
      if (callNum === 1) {
        return {
          text: "",
          toolCalls: [
            {
              id: "tc-session-1",
              name: "FileEdit",
              input: {
                file_path: join(projectDir, "package.json"),
                old_string: '"name":"original"',
                new_string: '"name":"session-one"',
              },
            },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      }

      if (callNum === 2) {
        return {
          text: "",
          toolCalls: [
            {
              id: "tc-session-2",
              name: "FileEdit",
              input: {
                file_path: join(projectDir, "package.json"),
                old_string: '"name":"session-one"',
                new_string: '"name":"session-two"',
              },
            },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      }

      return {
        text: "Done.",
        toolCalls: [],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const engine = new QueryEngine({
      provider,
      tools: [new FileEditTool()],
      maxTurns: 5,
      cwd: projectDir,
      permissionManager: new PermissionManager({
        mode: "always-ask",
        projectRoot: projectDir,
      }),
      resolvePermission: async () => {
        permissionPrompts += 1;
        return "allow-session";
      },
    });

    const result = await engine.process([{ role: "user", content: "update package twice" }]);

    expect(result.success).toBe(true);
    expect(permissionPrompts).toBe(1);
    expect(readFileSync(join(projectDir, "package.json"), "utf-8")).toContain('"name":"session-two"');
  });

  test("allow-always decision persists across permission manager instances", async () => {
    const projectDir = createTempDir("pebble-engine-resolve-persist-");
    const packageJsonPath = join(projectDir, "package.json");
    writeFileSync(packageJsonPath, '{"name":"original"}', "utf-8");

    const firstPermissionManager = new PermissionManager({
      mode: "always-ask",
      projectRoot: projectDir,
    });
    const firstEngine = new QueryEngine({
      provider: new ScriptedProvider(async (_msgs, callNum) => {
        if (callNum === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "tc-persist-1",
                name: "FileEdit",
                input: {
                  file_path: packageJsonPath,
                  old_string: '"name":"original"',
                  new_string: '"name":"persisted"',
                },
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 10 },
          };
        }

        return {
          text: "Persisted decision saved.",
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }),
      tools: [new FileEditTool()],
      maxTurns: 5,
      cwd: projectDir,
      permissionManager: firstPermissionManager,
      resolvePermission: async () => "allow-always",
    });

    const firstResult = await firstEngine.process([{ role: "user", content: "persist the edit approval" }]);

    expect(firstResult.success).toBe(true);
    expect(firstPermissionManager.getDecisions()).toEqual([
      expect.objectContaining({ toolName: "FileEdit", decision: "allow-always" }),
    ]);
    expect(readFileSync(packageJsonPath, "utf-8")).toContain('"name":"persisted"');

    const secondPermissionManager = new PermissionManager({
      mode: "always-ask",
      projectRoot: projectDir,
    });
    const secondEngine = new QueryEngine({
      provider: new ScriptedProvider(async (_msgs, callNum) => {
        if (callNum === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "tc-persist-2",
                name: "FileEdit",
                input: {
                  file_path: packageJsonPath,
                  old_string: '"name":"persisted"',
                  new_string: '"name":"final"',
                },
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 10 },
          };
        }

        return {
          text: "Persisted decision reused.",
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }),
      tools: [new FileEditTool()],
      maxTurns: 5,
      cwd: projectDir,
      permissionManager: secondPermissionManager,
    });

    const secondResult = await secondEngine.process([{ role: "user", content: "reuse the saved approval" }]);

    expect(secondResult.success).toBe(true);
    expect(readFileSync(packageJsonPath, "utf-8")).toContain('"name":"final"');
  });

  test("fires lifecycle callbacks for tool success and tool errors", async () => {
    const lifecycleEvents: string[] = [];
    const tool: Tool = {
      name: "LifecycleTool",
      description: "tracks lifecycle callback behavior",
      inputSchema: z.object({
        fail: z.boolean().optional(),
      }),
      async execute(input: unknown) {
        const candidate = input as { fail?: boolean };
        if (candidate.fail) {
          throw new Error("tool exploded");
        }

        return {
          success: true,
          output: "tool ok",
        };
      },
    };

    const provider = new ScriptedProvider((_messages, callNumber) => {
      if (callNumber === 1) {
        return {
          text: "",
          toolCalls: [
            { id: "life-ok", name: "LifecycleTool", input: { fail: false } },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }

      if (callNumber === 2) {
        return {
          text: "",
          toolCalls: [
            { id: "life-fail", name: "LifecycleTool", input: { fail: true } },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }

      return {
        text: "done",
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    const engine = new QueryEngine({
      provider,
      tools: [tool],
      onLifecycleEvent: async (event, context) => {
        if (event === "tool:before") {
          lifecycleEvents.push(`before:${context.toolName}:${String((context.toolInput as { fail?: boolean })?.fail ?? false)}`);
          return;
        }

        if (event === "tool:after") {
          lifecycleEvents.push(`after:${context.toolName}:${context.toolSuccess}`);
          return;
        }

        lifecycleEvents.push(`error:${context.error?.message}`);
      },
    });

    const result = await engine.process([{ role: "user", content: "run lifecycle tool twice" }]);

    expect(result.success).toBe(true);
    expect(lifecycleEvents).toEqual([
      "before:LifecycleTool:false",
      "after:LifecycleTool:true",
      "before:LifecycleTool:true",
      "after:LifecycleTool:false",
      "error:tool exploded",
    ]);
  });
});