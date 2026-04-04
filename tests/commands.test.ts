import { test, expect, describe } from "bun:test";
import { CommandRegistry } from "../src/commands/registry";
import { registerBuiltinCommands } from "../src/commands/builtins";

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
      cwd: process.cwd(),
      headless: false,
      config: {},
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("/help");
    expect(result.output).toContain("/exit");
  });

  test("executes exit command", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const result = await registry.execute("exit", "", {
      cwd: process.cwd(),
      headless: false,
      config: {},
    });
    expect(result.success).toBe(true);
    expect(result.exit).toBe(true);
  });

  test("reports unknown commands", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const result = await registry.execute("nonexistent", "", {
      cwd: process.cwd(),
      headless: false,
      config: {},
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown command");
  });
});
