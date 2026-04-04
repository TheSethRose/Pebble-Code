import { afterAll, afterEach, test, expect, describe } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandRegistry } from "../src/commands/registry";
import { registerBuiltinCommands } from "../src/commands/builtins";
import { SessionStore } from "../src/persistence/sessionStore";
import type { CommandContext } from "../src/commands/types";
import {
  getProjectSettingsPath,
  getSettingsPath,
  loadSettingsForCwd,
} from "../src/runtime/config";

const tempDirs: string[] = [];
const previousPebbleHome = process.env.PEBBLE_HOME;
const pebbleHomeDir = mkdtempSync(join(tmpdir(), "pebble-command-home-"));

process.env.PEBBLE_HOME = pebbleHomeDir;

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

  rmSync(pebbleHomeDir, { recursive: true, force: true });
  mkdirSync(pebbleHomeDir, { recursive: true });
});

afterAll(() => {
  process.env.PEBBLE_HOME = previousPebbleHome;
  rmSync(pebbleHomeDir, { recursive: true, force: true });
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

  test("/login persists an OpenRouter API key in ~/.pebble settings", async () => {
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
    expect(settingsPath.startsWith(pebbleHomeDir)).toBe(true);
    expect(existsSync(join(tempDir, ".pebble", "settings.json"))).toBe(false);

    const saved = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      providerAuth?: Record<string, { credential: string }>;
      provider?: string;
      model?: string;
      baseUrl?: string;
    };

    expect(saved.providerAuth?.openrouter?.credential).toBe("sk-or-v1-test-key");
    expect(saved.provider).toBeUndefined();
    expect(saved.model).toBeUndefined();
    expect(saved.baseUrl).toBeUndefined();

    const loaded = loadSettingsForCwd(tempDir);
    expect(loaded.apiKey).toBe("sk-or-v1-test-key");
    expect(loaded.provider).toBe("openrouter");
    expect(loaded.model).toBe("openrouter/auto");
    expect(loaded.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  test("/login persists non-default built-in providers with their defaults", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-login-openai-");

    const result = await registry.execute("login", "openai sk-openai-test-key", createCommandContext({
      cwd: tempDir,
      config: { provider: "openai" },
    }));

    expect(result.success).toBe(true);

    const settingsPath = getSettingsPath(tempDir);
    const saved = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      providerAuth?: Record<string, { credential: string }>;
      provider?: string;
      model?: string;
      baseUrl?: string;
    };

    expect(saved.providerAuth?.openai?.credential).toBe("sk-openai-test-key");
    expect(saved.provider).toBe("openai");

    const loaded = loadSettingsForCwd(tempDir);
    expect(loaded.apiKey).toBe("sk-openai-test-key");
    expect(loaded.provider).toBe("openai");
    expect(loaded.model).toBe("gpt-4o-mini");
    expect(loaded.baseUrl).toBe("https://api.openai.com/v1");
  });

  test("/login stores multiple provider credentials without overwriting prior ones", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-multi-login-");

    const first = await registry.execute("login", "openai sk-openai-test-key", createCommandContext({
      cwd: tempDir,
      config: { provider: "openai" },
    }));
    const second = await registry.execute("login", "openrouter sk-or-v1-test-key", createCommandContext({
      cwd: tempDir,
      config: { provider: "openrouter" },
    }));

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const saved = JSON.parse(readFileSync(getSettingsPath(tempDir), "utf-8")) as {
      providerAuth?: Record<string, { credential: string }>;
    };

    expect(saved.providerAuth?.openai?.credential).toBe("sk-openai-test-key");
    expect(saved.providerAuth?.openrouter?.credential).toBe("sk-or-v1-test-key");
  });

  test("/login github-copilot persists an OAuth session in ~/.pebble settings", async () => {
    const previousFetch = globalThis.fetch;
    const previousStdoutWrite = process.stdout.write;
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-copilot-login-");
    const writes: string[] = [];
    let fetchCall = 0;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    }) as typeof process.stdout.write;

    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchCall += 1;
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

      if (fetchCall === 1) {
        expect(url).toBe("https://github.com/login/device/code");
        return new Response(JSON.stringify({
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      expect(url).toBe("https://github.com/login/oauth/access_token");
      return new Response(JSON.stringify({
        access_token: "ghu_copilot_login_token",
        token_type: "bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await registry.execute("login", "github-copilot", createCommandContext({
      cwd: tempDir,
      config: { provider: "github-copilot" },
    }));

    globalThis.fetch = previousFetch;
    process.stdout.write = previousStdoutWrite;

    expect(result.success).toBe(true);
    expect(result.output).toContain("Saved OAuth session for github-copilot");
    expect(writes.join(" ")).toContain("GitHub Copilot device login");
    expect(writes.join(" ")).toContain("ABCD-EFGH");

    const settingsPath = getSettingsPath(tempDir);
    const saved = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      providerAuth?: Record<string, {
        credential?: string;
        oauth?: { accessToken?: string; tokenType?: string };
      }>;
      provider?: string;
      model?: string;
      baseUrl?: string;
    };

    expect(saved.provider).toBe("github-copilot");
    expect(saved.providerAuth?.["github-copilot"]?.oauth?.accessToken).toBe("ghu_copilot_login_token");
    expect(saved.providerAuth?.["github-copilot"]?.oauth?.tokenType).toBe("github-device");

    const loaded = loadSettingsForCwd(tempDir);
    expect(loaded.provider).toBe("github-copilot");
    expect(loaded.model).toBe("github-copilot/gpt-4o");
    expect(loaded.baseUrl).toBe("https://api.individual.githubcopilot.com");
  });

  test("/login refuses unsupported oauth providers instead of storing a fake API key", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-oauth-login-");

    const result = await registry.execute("login", "openai-codex fake-token", createCommandContext({
      cwd: tempDir,
      config: { provider: "openai-codex" },
    }));

    expect(result.success).toBe(true);
    expect(result.output).toContain("cannot be configured with a pasted");
    expect(existsSync(getSettingsPath(tempDir))).toBe(false);
  });

  test("migrates legacy workspace settings into ~/.pebble and deletes the leaked copy", () => {
    const tempDir = createTempProjectDir("pebble-command-migrate-");
    const legacySettingsPath = join(tempDir, ".pebble", "settings.json");
    mkdirSync(join(tempDir, ".pebble"), { recursive: true });
    writeFileSync(
      legacySettingsPath,
      JSON.stringify({ provider: "openrouter", apiKey: "legacy-secret" }, null, 2),
      "utf-8",
    );

    const loaded = loadSettingsForCwd(tempDir);
    const migratedSettingsPath = getSettingsPath(tempDir);

    expect(loaded.apiKey).toBe("legacy-secret");
    expect(migratedSettingsPath.startsWith(pebbleHomeDir)).toBe(true);
    expect(existsSync(migratedSettingsPath)).toBe(true);
    expect(existsSync(legacySettingsPath)).toBe(false);

    const migrated = JSON.parse(readFileSync(migratedSettingsPath, "utf-8")) as {
      provider: string;
      providerAuth?: Record<string, { credential: string }>;
    };
    expect(migrated.provider).toBe("openrouter");
    expect(migrated.providerAuth?.openrouter?.credential).toBe("legacy-secret");
  });

  test("loads committed repo defaults from .pebble/project-settings.json", () => {
    const tempDir = createTempProjectDir("pebble-command-project-defaults-");
    const projectSettingsPath = getProjectSettingsPath(tempDir);
    mkdirSync(join(tempDir, ".pebble"), { recursive: true });
    writeFileSync(
      projectSettingsPath,
      JSON.stringify({
        model: "openrouter/project-default",
        maxTurns: 12,
        telemetryEnabled: true,
      }, null, 2),
      "utf-8",
    );

    const loaded = loadSettingsForCwd(tempDir);

    expect(loaded.model).toBe("openrouter/project-default");
    expect(loaded.maxTurns).toBe(12);
    expect(loaded.telemetryEnabled).toBe(true);
  });

  test("saves only user overrides to ~/.pebble when repo defaults exist", async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const tempDir = createTempProjectDir("pebble-command-user-overrides-");
    const projectSettingsPath = getProjectSettingsPath(tempDir);
    mkdirSync(join(tempDir, ".pebble"), { recursive: true });
    writeFileSync(
      projectSettingsPath,
      JSON.stringify({
        provider: "openrouter",
        model: "openrouter/project-default",
        baseUrl: "https://openrouter.ai/api/v1",
        maxTurns: 22,
        telemetryEnabled: false,
        fullscreenRenderer: true,
      }, null, 2),
      "utf-8",
    );

    const result = await registry.execute("login", "openrouter sk-or-v1-test-key", createCommandContext({
      cwd: tempDir,
      config: { provider: "openrouter" },
    }));

    expect(result.success).toBe(true);

    const userSettingsPath = getSettingsPath(tempDir);
    const saved = JSON.parse(readFileSync(userSettingsPath, "utf-8")) as Record<string, unknown>;

    expect((saved.providerAuth as Record<string, { credential: string }> | undefined)?.openrouter?.credential).toBe("sk-or-v1-test-key");
    expect(saved.model).toBeUndefined();
    expect(saved.baseUrl).toBeUndefined();
    expect(saved.maxTurns).toBeUndefined();

    const loaded = loadSettingsForCwd(tempDir);
    expect(loaded.apiKey).toBe("sk-or-v1-test-key");
    expect(loaded.model).toBe("openrouter/project-default");
    expect(loaded.maxTurns).toBe(22);
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
