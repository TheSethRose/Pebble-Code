import { test, expect, describe } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CommandRegistry } from "../src/commands/registry";
import { registerBuiltinCommands } from "../src/commands/builtins";
import { SessionStore } from "../src/persistence/sessionStore";
import type { CommandContext } from "../src/commands/types";

function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cwd: process.cwd(),
    headless: false,
    config: {},
    trustLevel: "trusted",
    ...overrides,
  };
}

describe("Command Registry", () => {
  test("registers and finds commands", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    expect(registry.find("help")).toBeDefined();
    expect(registry.find("exit")).toBeDefined();
    expect(registry.find("clear")).toBeDefined();
    expect(registry.find("config")).toBeDefined();
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
    expect(result.output).toContain("/help");
    expect(result.output).toContain("/exit");
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

    const tempDir = join(process.cwd(), ".pebble", "test-command-sessions");
    rmSync(tempDir, { recursive: true, force: true });
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

    const tempDir = join(process.cwd(), ".pebble", "test-command-memory");
    rmSync(tempDir, { recursive: true, force: true });
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
  });
});
