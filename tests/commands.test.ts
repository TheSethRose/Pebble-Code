import { afterEach, test, expect, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRegistry } from "../src/commands/registry";
import { registerBuiltinCommands } from "../src/commands/builtins";
import { SessionStore } from "../src/persistence/sessionStore";
import type { CommandContext } from "../src/commands/types";
import { getSettingsPath } from "../src/runtime/config";

const tempDirs: string[] = [];

function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cwd: process.cwd(),
    headless: false,
    config: {},
    trustLevel: "trusted",
    ...overrides,
  };
}

function createTempProjectDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: prefix }, null, 2), "utf-8");
  return dir;
}

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

describe("Command Registry", () => {
  test("registers and finds commands", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.find("help")).toBeDefined();
    expect(registry.find("exit")).toBeDefined();
    expect(registry.find("clear")).toBeDefined();
    expect(registry.find("config")).toBeDefined();
    expect(registry.find("login")).toBeDefined();
    expect(registry.find("model")).toBeDefined();
    expect(registry.find("resume")).toBeDefined();
    expect(registry.find("memory")).toBeDefined();
    expect(registry.find("plan")).toBeDefined();
    expect(registry.find("review")).toBeDefined();
    expect(registry.find("permissions")).toBeDefined();
  });

  test("finds commands by alias", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.find("h")).toBeDefined();
    expect(registry.find("quit")).toBeDefined();
    expect(registry.find("cls")).toBeDefined();
    expect(registry.find("m")).toBeDefined();
  });

  test("detects command input", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.isCommand("/help")).toBe(true);
    expect(registry.isCommand("/exit")).toBe(true);
    expect(registry.isCommand("hello")).toBe(false);
    expect(registry.isCommand("")).toBe(false);
  });

  test("parses command input", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const result = registry.parseCommand("/model gpt-4");
    expect(result).toEqual({ name: "model", args: "gpt-4" });
  });

  test("executes help command", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const result = await registry.execute("help", "", {
      ...createCommandContext(),
    });
    expect(result.success).toBe(true);
    expect(result.data?.action).toBe("show-keybindings");
  });

  test("executes exit command", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const result = await registry.execute("exit", "", {
      ...createCommandContext(),
    });
    expect(result.success).toBe(true);
    expect(result.exit).toBe(true);
  });

  test("reports unknown commands", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const result = await registry.execute("nonexistent", "", {
      ...createCommandContext(),
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown command");
  });

  test("filters interactive commands in headless mode", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.isCommand("/help", createCommandContext({ headless: true }))).toBe(false);
  });

  test("resumes the latest session", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempDir("pebble-command-sessions-");
    mkdirSync(tempDir, { recursive: true });

    const store = new SessionStore(tempDir);
    const session = store.createSession("resume-test");
    store.appendMessage(session.id, {
      role: "user",
      content: "hello",
      timestamp: new Date().toISOString(),
    });

    const result = await registry.execute("resume", "", createCommandContext({
      sessionStore: store,
      sessionId: session.id,
    }));

    expect(result.success).toBe(true);
    expect(result.output).toContain("Resumed session resume-test");
    expect(result.data?.sessionId).toBe("resume-test");
  });

  test("reports memory status for the active session", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempDir("pebble-command-memory-");
    mkdirSync(tempDir, { recursive: true });

    const store = new SessionStore(tempDir);
    const session = store.createSession("memory-test");
    store.appendMessage(session.id, {
      role: "user",
      content: "hello world",
      timestamp: new Date().toISOString(),
    });

    const result = await registry.execute("memory", "", createCommandContext({
      sessionStore: store,
      sessionId: session.id,
      config: { compactThreshold: 10 },
    }));

    expect(result.success).toBe(true);
    expect(result.output).toContain("Session memory: memory-test");
    expect(result.output).toContain("Estimated tokens:");

    const transcript = store.loadTranscript(session.id);
    expect(transcript?.memory?.summary).toBeTruthy();
    expect(transcript?.memory?.sourceMessageCount).toBe(1);
  });

  test("/memory clear removes persisted session memory", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempDir("pebble-command-memory-clear-");
    mkdirSync(tempDir, { recursive: true });

    const store = new SessionStore(tempDir);
    const session = store.createSession("memory-clear-test");
    store.appendMessage(session.id, {
      role: "user",
      content: "remember this session",
      timestamp: new Date().toISOString(),
    });

    await registry.execute("memory", "", createCommandContext({
      sessionStore: store,
      sessionId: session.id,
    }));

    const result = await registry.execute("memory", "clear", createCommandContext({
      sessionStore: store,
      sessionId: session.id,
    }));

    expect(result.success).toBe(true);
    expect(result.output).toContain("Cleared session memory");
    expect(store.loadTranscript(session.id)?.memory).toBeUndefined();
  });

  test("/login persists an OpenRouter API key in project settings", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-login-");

    const result = await registry.execute("login", "openrouter sk-or-v1-test-key", createCommandContext({
      cwd: tempDir,
      config: { provider: "openrouter" },
    }));

    expect(result.success).toBe(true);
    const settingsPath = getSettingsPath(tempDir);
    expect(existsSync(settingsPath)).toBe(true);

    const saved = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      provider: string;
      apiKey: string;
      model: string;
      baseUrl: string;
    };

    expect(saved.provider).toBe("openrouter");
    expect(saved.apiKey).toBe("sk-or-v1-test-key");
    expect(saved.model).toBe("openrouter/auto");
    expect(saved.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  test("/config opens the settings UI", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-config-");
    const previousOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
    const previousPebbleApiKey = process.env.PEBBLE_API_KEY;

    delete process.env.OPENROUTER_API_KEY;
    delete process.env.PEBBLE_API_KEY;

    const result = await registry.execute("config", "", createCommandContext({
      cwd: tempDir,
      config: { provider: "openrouter" },
    }));

    process.env.OPENROUTER_API_KEY = previousOpenRouterApiKey;
    process.env.PEBBLE_API_KEY = previousPebbleApiKey;

    // /config is now a UI command that opens the Settings component, so it returns empty output
    expect(result.success).toBe(true);
    expect(result.output).toBe("");
  });
});
