import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { run } from "../src/runtime/main";
import { createProjectSessionStore } from "../src/persistence/runtimeSessions";
import { PermissionManager } from "../src/runtime/permissionManager";
import type { CommandContext } from "../src/commands/types";
import { App } from "../src/ui/App";
import type { Message } from "../src/engine/types";
import type { Provider, ProviderCapabilities, ProviderOptions, StreamChunk } from "../src/providers/types";

const tempDirs: string[] = [];

function createTempProject(
  prefix: string,
  options: {
    settings?: Record<string, unknown>;
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);

  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: prefix }, null, 2), "utf-8");

  if (options.settings) {
    const pebbleDir = join(dir, ".pebble");
    mkdirSync(pebbleDir, { recursive: true });
    writeFileSync(join(pebbleDir, "settings.json"), JSON.stringify(options.settings, null, 2), "utf-8");
  }

  return dir;
}

async function captureConsole<T>(callback: () => Promise<T>): Promise<{
  result: T;
  stdout: string[];
  stderr: string[];
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    stdout.push(args.map((arg) => String(arg)).join(" "));
  };

  console.error = (...args: unknown[]) => {
    stderr.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    const result = await callback();
    return { result, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function withProviderKeysUnset<T>(callback: () => Promise<T>): Promise<T> {
  const previousOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  const previousPebbleApiKey = process.env.PEBBLE_API_KEY;

  delete process.env.OPENROUTER_API_KEY;
  delete process.env.PEBBLE_API_KEY;

  return callback().finally(() => {
    process.env.OPENROUTER_API_KEY = previousOpenRouterApiKey;
    process.env.PEBBLE_API_KEY = previousPebbleApiKey;
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("headless runtime", () => {
  test("emits NDJSON SDK events when format=json-stream", async () => {
    const projectDir = createTempProject("pebble-runtime-json-stream-");

    const { result: exitCode, stdout, stderr } = await withProviderKeysUnset(() =>
      captureConsole(() =>
        run({
          headless: true,
          prompt: "summarize the README",
          cwd: projectDir,
          format: "json-stream",
        }),
      ),
    );

    expect(exitCode).toBe(0);
    const events = stdout.map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(events[0]).toMatchObject({ type: "init" });
    expect(events[1]).toMatchObject({ type: "user_replay", text: "summarize the README" });
    expect(events.some((event) => event.type === "stream_event" && event.event === "progress")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "stream_event"
          && event.event === "text_delta"
          && JSON.stringify(event.data).includes("not configured"),
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "result", status: "success" });
    expect(stderr.some((line) => line.includes("Output format: json-stream"))).toBe(true);
  });

  test("prints plain assistant text by default in headless mode", async () => {
    const projectDir = createTempProject("pebble-runtime-text-");

    const { result: exitCode, stdout } = await withProviderKeysUnset(() =>
      captureConsole(() =>
        run({
          headless: true,
          prompt: "hello there",
          cwd: projectDir,
        }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain("is not configured");
    expect(stdout[0]?.trim().startsWith("{")).toBe(false);
  });

  test("automatically compacts long resumed sessions during headless execution", async () => {
    const projectDir = createTempProject("pebble-runtime-compact-", {
      settings: {
        compactThreshold: 1,
      },
    });

    const store = createProjectSessionStore(projectDir);
    const session = store.createSession("resume-compaction-test");

    for (let index = 0; index < 30; index += 1) {
      store.appendMessage(session.id, {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index}`,
        timestamp: new Date().toISOString(),
      });
    }

    const { result: exitCode, stdout } = await withProviderKeysUnset(() =>
      captureConsole(() =>
        run({
          headless: true,
          prompt: "continue",
          cwd: projectDir,
          resume: session.id,
          format: "json",
        }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({ type: "result", status: "success" });

    const compacted = store.loadTranscript(session.id);
    expect(compacted).not.toBeNull();
    expect(compacted?.messages.length).toBeLessThan(32);
    expect(compacted?.messages.some((message) => message.content.startsWith("[Summary of"))).toBe(true);
    expect(compacted?.metadata?.compactionCount).toBeGreaterThan(0);
  });

  test("loads extension providers, skill instructions, and MCP configs during boot", async () => {
    const projectDir = createTempProject("pebble-runtime-extensions-", {
      settings: {
        provider: "echo-ext",
        mcpServers: [
          { name: "local-docs", command: "bunx", args: ["demo"], transport: "stdio" },
          { name: "broken-http", transport: "http" },
        ],
      },
    });
    const extensionsDir = join(projectDir, "extensions");
    const skillDir = join(extensionsDir, "reviewer");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(extensionsDir, "provider.ts"),
      `
class EchoProvider {
  id = "echo-ext";
  name = "Echo Extension Provider";
  model = "echo-model";

  getCapabilities() {
    return {
      streaming: true,
      toolUse: false,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  async complete(_messages, options) {
    return {
      text: (options?.systemPrompt ?? "").includes("Always inspect diffs before proposing changes.")
        ? "skill instructions injected"
        : "missing skill instructions",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async *stream(_messages, options) {
    const text = (options?.systemPrompt ?? "").includes("Always inspect diffs before proposing changes.")
      ? "skill instructions injected"
      : "missing skill instructions";
    yield { textDelta: text, done: true, metadata: { stopReason: "end_turn" } };
  }

  isConfigured() {
    return true;
  }
}

export default {
  metadata: {
    id: "echo-provider-extension",
    name: "Echo Provider Extension",
    version: "1.0.0"
  },
  providers: [new EchoProvider()],
};
      `.trim(),
      "utf-8",
    );

    writeFileSync(
      join(skillDir, "SKILL.md"),
      "# Reviewer\n\nAlways inspect diffs before proposing changes.",
      "utf-8",
    );

    const { result: exitCode, stdout, stderr } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "hello",
        cwd: projectDir,
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain("skill instructions injected");
    expect(stderr.some((line) => line.includes("Provider: Echo Extension Provider (echo-model)"))).toBe(true);
    expect(stderr.some((line) => line.includes("Extensions: 1 plugin(s), 1 skill(s), 1 MCP server(s), 1 provider(s)"))).toBe(true);
    expect(stderr.some((line) => line.includes("broken-http"))).toBe(true);
  });

  test("surfaces persisted background session state during boot", async () => {
    const projectDir = createTempProject("pebble-runtime-background-");
    const sessionsDir = join(projectDir, ".pebble", "background-sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "bg-1.meta.json"),
      JSON.stringify({
        id: "bg-1",
        pid: 12345,
        status: "running",
        startedAt: new Date().toISOString(),
        logFile: join(sessionsDir, "bg-1.log"),
      }, null, 2),
      "utf-8",
    );

    const { result: exitCode, stderr } = await withProviderKeysUnset(() =>
      captureConsole(() =>
        run({
          headless: true,
          prompt: "status",
          cwd: projectDir,
        }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stderr.some((line) => line.includes("Background sessions: 1"))).toBe(true);
  });
});

describe("interactive runtime permissions", () => {
  test("deny blocks risky tool execution from the interactive app", async () => {
    const projectDir = createTempProject("pebble-runtime-interactive-deny-", {
      settings: {
        provider: "interactive-scripted",
        permissionMode: "always-ask",
        fullscreenRenderer: false,
      },
    });

    const packageJsonPath = join(projectDir, "package.json");
    writeFileSync(packageJsonPath, '{"name":"original"}', "utf-8");

    const sessionStore = createProjectSessionStore(projectDir);
    const permissionManager = new PermissionManager({
      mode: "always-ask",
      projectRoot: projectDir,
    });
    const provider = new InteractiveScriptedProvider(packageJsonPath);
    const app = mountInteractiveApp({
      cwd: projectDir,
      sessionStore,
      permissionManager,
      extensionProviders: [provider],
    });

    try {
      await submitPrompt(app.stdin, "change original to denied");
      const sessionId = await waitForSessionId(sessionStore);

      await waitFor(() => permissionManager.getPendingApprovals(sessionId).length === 1);
      expect(app.output()).toContain("Permission Required");

      await sendKeys(app.stdin, "\u001B");

      await waitFor(() => {
        const transcript = sessionStore.loadTranscript(sessionId);
        return Boolean(transcript?.messages.some((message) => message.content.includes("Tool execution denied")));
      });

      expect(readFileSync(packageJsonPath, "utf-8")).toBe('{"name":"original"}');
      const transcript = sessionStore.loadTranscript(sessionId);
      expect(transcript?.messages.some((message) => message.content.includes("Tool execution denied: User decision"))).toBe(true);
      expect(permissionManager.getPendingApprovals(sessionId)).toHaveLength(0);
    } finally {
      app.cleanup();
    }
  });

});

describe("runtime hook ordering", () => {
  test("fires extension hooks in order across a successful headless turn with tool execution", async () => {
    const projectDir = createTempProject("pebble-runtime-hook-order-success-", {
      settings: {
        provider: "hook-order-provider",
      },
    });
    const logFile = join(projectDir, "hook-events.success.jsonl");

    writeHookOrderExtension(projectDir, logFile, "tool-success");

    const { result: exitCode } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "read package json",
        cwd: projectDir,
      }),
    );

    expect(exitCode).toBe(0);
    expect(readHookEvents(logFile).map((entry) => entry.event)).toEqual([
      "session:start",
      "turn:before",
      "tool:before",
      "tool:after",
      "turn:after",
      "session:end",
    ]);
    expect(readHookEvents(logFile)[2]).toMatchObject({ event: "tool:before", toolName: "WorkspaceRead" });
    expect(readHookEvents(logFile)[3]).toMatchObject({ event: "tool:after", toolName: "WorkspaceRead", toolSuccess: true });
  });

  test("fires extension error hooks before session shutdown when the provider errors", async () => {
    const projectDir = createTempProject("pebble-runtime-hook-order-error-", {
      settings: {
        provider: "hook-order-provider",
      },
    });
    const logFile = join(projectDir, "hook-events.error.jsonl");

    writeHookOrderExtension(projectDir, logFile, "provider-error");

    const { result: exitCode } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "trigger provider error",
        cwd: projectDir,
      }),
    );

    expect(exitCode).toBe(1);
    expect(readHookEvents(logFile).map((entry) => entry.event)).toEqual([
      "session:start",
      "turn:before",
      "error",
      "turn:after",
      "session:end",
    ]);
    expect(readHookEvents(logFile)[2]).toMatchObject({ event: "error", error: "Provider exploded." });
  });
});

class InteractiveScriptedProvider implements Provider {
  readonly id = "interactive-scripted";
  readonly name = "Interactive Scripted Provider";
  readonly model = "interactive-scripted-model";

  constructor(private readonly packageJsonPath: string) {}

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

  async complete(): Promise<never> {
    throw new Error("InteractiveScriptedProvider only supports streaming");
  }

  async *stream(messages: Message[], _options?: ProviderOptions): AsyncIterable<StreamChunk> {
    const lastMessage = messages.at(-1);
    if (!lastMessage) {
      return;
    }

    if (lastMessage.role === "user") {
      const plan = parseEditPlan(lastMessage.content);
      yield {
        toolCall: {
          id: `edit-${plan.nextValue}`,
          name: "FileEdit",
          input: {
            file_path: this.packageJsonPath,
            old_string: `"name":"${plan.previousValue}"`,
            new_string: `"name":"${plan.nextValue}"`,
          },
        },
        done: false,
      };
      yield {
        done: true,
        metadata: {
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      };
      return;
    }

    if (lastMessage.role === "tool") {
      const denied = lastMessage.content.includes("Tool execution denied");
      const message = denied
        ? "User denied the package edit."
        : `Updated package name to ${readPackageName(this.packageJsonPath)}.`;
      yield {
        textDelta: message,
        done: true,
        metadata: {
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      };
    }
  }

  isConfigured(): boolean {
    return true;
  }
}

function parseEditPlan(prompt: string): { previousValue: string; nextValue: string } {
  const match = prompt.match(/change\s+(\S+)\s+to\s+(\S+)/i);
  if (!match) {
    throw new Error(`Unsupported interactive test prompt: ${prompt}`);
  }

  const previousValue = match[1];
  const nextValue = match[2];
  if (!previousValue || !nextValue) {
    throw new Error(`Incomplete interactive test prompt: ${prompt}`);
  }

  return {
    previousValue,
    nextValue,
  };
}

function readPackageName(packageJsonPath: string): string {
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name: string };
  return parsed.name;
}

class TestInput extends PassThrough {
  isTTY = true;
  setRawMode(_value: boolean): void {}
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

class TestOutput extends PassThrough {
  isTTY = true;
  columns = 100;
  rows = 40;
}

function mountInteractiveApp(context: Pick<CommandContext, "cwd"> & Partial<CommandContext>): {
  stdin: TestInput;
  output: () => string;
  cleanup: () => void;
} {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  const stderr = new TestOutput();
  let buffer = "";
  const { cwd, headless, config, ...restContext } = context;

  const append = (chunk: string | Buffer) => {
    buffer += chunk.toString();
  };

  stdout.on("data", append);
  stderr.on("data", append);

  const appContext: CommandContext = {
    ...restContext,
    cwd,
    headless: headless ?? false,
    config: config ?? {},
  };

  const instance = render(React.createElement(App, { context: appContext }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    stdin,
    output: () => buffer,
    cleanup: () => {
      instance.unmount();
      instance.cleanup();
      stdout.off("data", append);
      stderr.off("data", append);
      stdin.end();
      stdout.end();
      stderr.end();
    },
  };
}

async function submitPrompt(stdin: TestInput, prompt: string): Promise<void> {
  await sendKeys(stdin, prompt);
  await sendKeys(stdin, "\r");
}

async function sendKeys(stdin: TestInput, keys: string): Promise<void> {
  stdin.write(keys);
  await flushInteractiveUi();
}

async function waitForSessionId(sessionStore: ReturnType<typeof createProjectSessionStore>): Promise<string> {
  await waitFor(() => sessionStore.listSessions().length > 0);
  const session = sessionStore.getLatestSession();
  if (!session) {
    throw new Error("Expected interactive session to be created");
  }

  return session.id;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await flushInteractiveUi();
  }

  throw new Error("Timed out waiting for interactive condition");
}

async function flushInteractiveUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function writeHookOrderExtension(
  projectDir: string,
  logFile: string,
  mode: "tool-success" | "provider-error",
): void {
  const extensionsDir = join(projectDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  writeFileSync(
    join(extensionsDir, "hook-order.ts"),
    `
import { appendFileSync } from "node:fs";

const LOG_FILE = ${JSON.stringify(logFile)};
const PACKAGE_JSON = ${JSON.stringify(join(projectDir, "package.json"))};
const MODE = ${JSON.stringify(mode)};

function record(event, context = {}) {
  appendFileSync(LOG_FILE, JSON.stringify({
    event,
    toolName: context.toolName ?? null,
    toolSuccess: context.toolSuccess ?? null,
    error: context.error?.message ?? null,
  }) + "\\n", "utf-8");
}

class HookOrderProvider {
  id = "hook-order-provider";
  name = "Hook Order Provider";
  model = "hook-order-model";

  getCapabilities() {
    return {
      streaming: false,
      toolUse: true,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  async complete(messages) {
    const lastMessage = messages.at(-1);
    if (MODE === "provider-error") {
      return {
        text: "Provider exploded.",
        toolCalls: [],
        stopReason: "error",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }

    if (lastMessage?.role === "user") {
      return {
        text: "",
        toolCalls: [
          {
            id: "hook-read-1",
            name: "WorkspaceRead",
            input: {
              action: "read_file",
              file_path: PACKAGE_JSON,
            },
          },
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
  }

  async *stream() {
    throw new Error("HookOrderProvider only supports complete()");
  }

  isConfigured() {
    return true;
  }
}

export default {
  metadata: {
    id: "hook-order-extension",
    name: "Hook Order Extension",
    version: "1.0.0"
  },
  providers: [new HookOrderProvider()],
  hooks: {
    onSessionStart: async (context) => record("session:start", context),
    onBeforeTurn: async (context) => record("turn:before", context),
    onBeforeTool: async (context) => record("tool:before", context),
    onAfterTool: async (context) => record("tool:after", context),
    onAfterTurn: async (context) => record("turn:after", context),
    onError: async (context) => record("error", context),
    onSessionEnd: async (context) => record("session:end", context),
  },
};
    `.trim(),
    "utf-8",
  );
}

function readHookEvents(logFile: string): Array<{
  event: string;
  toolName: string | null;
  toolSuccess: boolean | null;
  error: string | null;
}> {
  return readFileSync(logFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      event: string;
      toolName: string | null;
      toolSuccess: boolean | null;
      error: string | null;
    });
}