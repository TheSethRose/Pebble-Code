import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRegistry } from "../src/commands/registry";
import type { Command } from "../src/commands/types";
import {
  loadConfiguredMcpServers,
  loadExtensions,
  loadRuntimeIntegrations,
} from "../src/extensions/loaders";
import { createHookRegistry } from "../src/runtime/hooks";
import type { Tool } from "../src/tools/Tool";
import { createMvpTools } from "../src/tools/orchestration";

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

describe("Extension loading", () => {
  test("loads extension commands from a plugin module", async () => {
    const dir = createTempDir("pebble-extension-");
    writeFileSync(
      join(dir, "hello.ts"),
      `
export default {
  metadata: {
    id: "hello-plugin",
    name: "Hello Plugin",
    version: "1.0.0"
  },
  commands: [
    {
      name: "hello-ext",
      description: "hello from extension",
      type: "local",
      execute() {
        return { success: true, output: "hello from extension" };
      }
    }
  ]
};
      `.trim(),
      "utf-8",
    );

    const results = await loadExtensions([dir]);
    expect(results).toHaveLength(1);
    expect(results[0]?.loaded).toBe(true);
    expect(results[0]?.extension?.commands?.[0]?.name).toBe("hello-ext");
  });

  test("isolates broken extension modules", async () => {
    const dir = createTempDir("pebble-extension-broken-");
    writeFileSync(join(dir, "broken.ts"), `export default { nope: true };`, "utf-8");

    const results = await loadExtensions([dir]);
    expect(results).toHaveLength(1);
    expect(results[0]?.loaded).toBe(false);
    expect(results[0]?.error).toContain("valid plugin, skill, or MCP entry");
  });

  test("discovers local skills from SKILL.md with typed metadata", async () => {
    const dir = createTempDir("pebble-extension-skill-");
    const skillDir = join(dir, "reviewer");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Reviewer\n\nAlways inspect diffs before proposing changes.", "utf-8");
    writeFileSync(
      join(skillDir, "skill.json"),
      JSON.stringify({
        id: "reviewer-skill",
        name: "Reviewer",
        version: "1.2.3",
        description: "Reviews local code changes",
        triggers: ["review", "diff"],
        requiredTools: ["WorkspaceRead"],
      }, null, 2),
      "utf-8",
    );

    const results = await loadExtensions([dir]);
    expect(results).toHaveLength(1);
    expect(results[0]?.manifest.type).toBe("skill");
    expect(results[0]?.loaded).toBe(true);
    expect(results[0]?.skills?.[0]).toMatchObject({
      id: "reviewer-skill",
      name: "Reviewer",
      version: "1.2.3",
      triggers: ["review", "diff"],
      requiredTools: ["WorkspaceRead"],
    });
    expect(results[0]?.skills?.[0]?.instructions).toContain("Always inspect diffs");
  });

  test("detects explicit MCP entries and validates configured MCP servers", async () => {
    const dir = createTempDir("pebble-extension-mcp-");
    writeFileSync(
      join(dir, "mcp.ts"),
      `
export default {
  metadata: {
    id: "docs-mcp",
    name: "Docs MCP",
    version: "1.0.0",
    type: "mcp"
  },
  mcpServers: [
    {
      name: "docs-http",
      transport: "http",
      url: "https://example.com/mcp"
    }
  ]
};
      `.trim(),
      "utf-8",
    );

    const runtimeIntegrations = await loadRuntimeIntegrations([dir], {
      mcpServers: [
        { name: "stdio-ok", command: "bunx", args: ["demo"], transport: "stdio" },
        { name: "broken-http", transport: "http" },
      ],
    });

    expect(runtimeIntegrations.mcpServers).toHaveLength(2);
    expect(runtimeIntegrations.results.some((result) => result.manifest.type === "mcp" && result.loaded && result.manifest.name === "Docs MCP")).toBe(true);
    expect(runtimeIntegrations.results.some((result) => result.manifest.type === "mcp" && !result.loaded && result.manifest.name === "broken-http")).toBe(true);

    const configured = loadConfiguredMcpServers([
      { name: "valid-http", transport: "http", url: "https://example.com/valid" },
      { name: "missing-command", transport: "stdio" },
    ]);

    expect(configured[0]).toMatchObject({ loaded: true, manifest: { name: "valid-http", type: "mcp" } });
    expect(configured[1]).toMatchObject({ loaded: false, manifest: { name: "missing-command", type: "mcp" } });
  });
});

describe("Command registry extension merging", () => {
  test("registerMany merges extension commands into the live registry", async () => {
    const registry = new CommandRegistry();
    const extensionCommand: Command = {
      name: "hello-ext",
      description: "hello from extension",
      type: "local",
      execute: () => ({ success: true, output: "hello from extension" }),
    };

    registry.registerMany([extensionCommand]);

    expect(registry.find("hello-ext")).toBeDefined();
    const result = await registry.execute("hello-ext", "", {
      cwd: process.cwd(),
      headless: false,
      config: {},
      trustLevel: "trusted",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("hello from extension");
  });

  test("createMvpTools merges extension tools into the runtime toolset", async () => {
    const dir = createTempDir("pebble-extension-tools-");
    writeFileSync(
      join(dir, "tool.ts"),
      `
export default {
  metadata: {
    id: "tool-plugin",
    name: "Tool Plugin",
    version: "1.0.0"
  },
  tools: [
    {
      name: "HelloTool",
      description: "returns a greeting",
      inputSchema: {
        safeParse(input) {
          return { success: true, data: input };
        }
      },
      async execute() {
        return { success: true, output: "hello from tool" };
      }
    }
  ]
};
      `.trim(),
      "utf-8",
    );

    const results = await loadExtensions([dir]);
    const extensionTools = results.flatMap((result) => result.extension?.tools ?? []);
    const tools = createMvpTools(extensionTools as Tool[]);
    const helloTool = tools.find((tool) => tool.name === "HelloTool");

    expect(helloTool).toBeDefined();
    const execution = await helloTool?.execute({}, {
      cwd: process.cwd(),
      permissionMode: "always-ask",
    });

    expect(execution).toEqual({ success: true, output: "hello from tool" });
  });

  test("hook registry wires extension lifecycle hooks", async () => {
    const events: string[] = [];
    const registry = createHookRegistry([
      {
        metadata: {
          id: "hooks-plugin",
          name: "Hooks Plugin",
          version: "1.0.0",
        },
        hooks: {
          onSessionStart: async () => {
            events.push("session:start");
          },
          onBeforeTurn: async () => {
            events.push("turn:before");
          },
          onAfterTurn: async () => {
            events.push("turn:after");
          },
          onBeforeTool: async (context) => {
            events.push(`tool:before:${context.toolName}`);
          },
          onAfterTool: async (context) => {
            events.push(`tool:after:${context.toolName}:${context.toolSuccess}`);
          },
          onError: async (context) => {
            events.push(`error:${context.error?.message}`);
          },
          onSessionEnd: async () => {
            events.push("session:end");
          },
        },
      },
    ]);

    await registry.fire("session:start", { sessionId: "test-session" });
    await registry.fire("turn:before", { sessionId: "test-session" });
    await registry.fire("turn:after", { sessionId: "test-session" });
    await registry.fire("tool:before", { sessionId: "test-session", toolName: "FileEdit" });
    await registry.fire("tool:after", { sessionId: "test-session", toolName: "FileEdit", toolSuccess: true });
    await registry.fire("error", { sessionId: "test-session", error: new Error("boom") });
    await registry.fire("session:end", { sessionId: "test-session" });

    expect(events).toEqual([
      "session:start",
      "turn:before",
      "turn:after",
      "tool:before:FileEdit",
      "tool:after:FileEdit:true",
      "error:boom",
      "session:end",
    ]);
  });
});