import React from "react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { run, setStartReplForTesting } from "../src/runtime/main";
import { getBackgroundRunsDir, saveBackgroundRunRecord } from "../src/runtime/backgroundRuns";
import { buildSessionMemory } from "../src/persistence/memory";
import {
  createProjectSessionStore,
  deleteSessionWithRuntimeCleanup,
} from "../src/persistence/runtimeSessions";
import { PermissionManager } from "../src/runtime/permissionManager";
import { WorktreeManager } from "../src/runtime/worktrees";
import type { CommandContext } from "../src/commands/types";
import { App } from "../src/ui/App";
import type { Message } from "../src/engine/types";
import type { Provider, ProviderCapabilities, ProviderOptions, StreamChunk } from "../src/providers/types";
import type { PendingPermission, PermissionChoice } from "../src/ui/types";
import { getSettingsPath } from "../src/runtime/config";
import { setVoiceRuntimeForTesting, type VoiceRuntime } from "../src/voice/runtime";

const tempDirs: string[] = [];
const previousPebbleHome = process.env.PEBBLE_HOME;
const pebbleHomeDir = mkdtempSync(join(tmpdir(), "pebble-runtime-home-"));

process.env.PEBBLE_HOME = pebbleHomeDir;

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
    const settingsPath = getSettingsPath(dir);
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(options.settings, null, 2), "utf-8");
  }

  return dir;
}

function initializeGitRepo(projectDir: string): void {
  Bun.spawnSync({ cmd: ["git", "init", "-q"], cwd: projectDir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync({ cmd: ["git", "config", "user.email", "tests@example.com"], cwd: projectDir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync({ cmd: ["git", "config", "user.name", "Pebble Tests"], cwd: projectDir, stdout: "pipe", stderr: "pipe" });
}

function commitAll(projectDir: string, message: string): void {
  Bun.spawnSync({ cmd: ["git", "add", "."], cwd: projectDir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync({ cmd: ["git", "commit", "-m", message, "--quiet"], cwd: projectDir, stdout: "pipe", stderr: "pipe" });
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

  rmSync(pebbleHomeDir, { recursive: true, force: true });
  mkdirSync(pebbleHomeDir, { recursive: true });
  setVoiceRuntimeForTesting(null);
});

afterAll(() => {
  process.env.PEBBLE_HOME = previousPebbleHome;
  rmSync(pebbleHomeDir, { recursive: true, force: true });
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

  test("surfaces cataloged-but-unimplemented provider messaging instead of falling back to OpenRouter", async () => {
    const projectDir = createTempProject("pebble-runtime-unsupported-provider-", {
      settings: {
        provider: "anthropic",
      },
    });

    const { result: exitCode, stdout, stderr } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "hello",
        cwd: projectDir,
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Anthropic is cataloged in Pebble");
    expect(stderr.some((line) => line.includes("Provider: Anthropic"))).toBe(true);
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
    expect(compacted?.messages.some((message) => message.content.startsWith("[Compacted transcript summary]"))).toBe(true);
    expect(compacted?.metadata?.compactionCount).toBeGreaterThan(0);
  });

  test("surfaces persisted background run counts during runtime boot", async () => {
    const projectDir = createTempProject("pebble-runtime-background-summary-");
    const runId = "bg-persisted-runtime-test";
    const runsDir = getBackgroundRunsDir(projectDir);
    const recordPath = join(runsDir, "records", `${runId}.json`);
    const logPath = join(runsDir, "logs", `${runId}.log`);
    const now = new Date().toISOString();

    saveBackgroundRunRecord(recordPath, {
      id: runId,
      task: "agent",
      status: "completed",
      cwd: projectDir,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      prompt: "Summarize current project setup",
      sessionId: `background-session-${runId}`,
      parentSessionId: null,
      initiatedBy: "runtime-test",
      logPath,
      recordPath,
      exitCode: 0,
      summary: "Background agent run completed.",
    });

    const { result: exitCode, stderr } = await withProviderKeysUnset(() =>
      captureConsole(() =>
        run({
          headless: true,
          prompt: "hello",
          cwd: projectDir,
          format: "json",
        }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stderr.some((line) => line.includes("Background runs: 1 total"))).toBe(true);
  }, 15_000);

  test("fires compaction hooks and persists provider markers when transcript compaction runs", async () => {
    const projectDir = createTempProject("pebble-runtime-compaction-hooks-", {
      settings: {
        compactThreshold: 1,
        compactPrepareThreshold: 1,
        compactionInstructions: "Preserve action items and next steps.",
        providerCompactionMarkers: true,
      },
    });
    const extensionsDir = join(projectDir, "extensions");
    mkdirSync(extensionsDir, { recursive: true });
    const hookLogPath = join(projectDir, "compaction-hooks.log");

    writeFileSync(
      join(extensionsDir, "compaction-hooks.ts"),
      [
        'import { appendFileSync } from "node:fs";',
        `const hookLogPath = ${JSON.stringify(hookLogPath)};`,
        "export default {",
        '  metadata: { id: "compaction-hooks", name: "Compaction Hooks", version: "0.0.0" },',
        "  hooks: {",
        '    async onPreCompact(context) { appendFileSync(hookLogPath, `pre:${String(context.preparedOnly)}:${String(context.providerId)}\\n`, "utf-8"); },',
        '    async onPostCompact(context) { appendFileSync(hookLogPath, `post:${String(context.providerId)}:${String(context.model)}\\n`, "utf-8"); },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const store = createProjectSessionStore(projectDir);
    const session = store.createSession("compaction-hook-session");
    for (let index = 0; index < 30; index += 1) {
      store.appendMessage(session.id, {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Compaction hook message ${index}`,
        timestamp: new Date().toISOString(),
      });
    }

    const { result: exitCode } = await withProviderKeysUnset(() =>
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
    const compacted = store.loadTranscript(session.id);
    expect(compacted?.metadata?.lastProviderCompactionMarker).toMatchObject({
      providerId: "openrouter",
      instructionsApplied: true,
    });
    expect(compacted?.metadata?.lastCompactionInstructions).toBe("Preserve action items and next steps.");
    expect(readFileSync(hookLogPath, "utf-8")).toContain("pre:false:openrouter");
    expect(readFileSync(hookLogPath, "utf-8")).toContain("post:openrouter:");
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

    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.getLatestSession();
    expect(session?.metadata).toMatchObject({
      lastHeadlessRun: expect.objectContaining({
        format: "text",
        providerId: "echo-ext",
        providerLabel: "Echo Extension Provider",
        model: "echo-model",
        success: true,
        status: "success",
      }),
    });
  });

  test("ignores placeholder background session files during boot", async () => {
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
    expect(stderr.some((line) => line.includes("Background sessions:"))).toBe(false);
    expect(stderr.some((line) => line.includes("Worktree root:"))).toBe(true);
    expect(stderr.some((line) => line.includes("Worktree support:"))).toBe(true);
  });

  test("prunes worktrees for deleted sessions during runtime boot", async () => {
    const projectDir = createTempProject("pebble-runtime-worktree-prune-");
    initializeGitRepo(projectDir);
    writeFileSync(join(projectDir, "tracked.txt"), "base\n", "utf-8");
    commitAll(projectDir, "initial");

    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.createSession("deleted-session");
    const manager = new WorktreeManager({ repoRoot: projectDir });
    const worktreePath = manager.createWorktree(session.id, `${session.id}-worktree`);

    expect(existsSync(worktreePath)).toBe(true);
    sessionStore.deleteSession(session.id);

    const { result: exitCode } = await withProviderKeysUnset(() =>
      captureConsole(() =>
        run({
          headless: true,
          prompt: "status",
          cwd: projectDir,
        }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(readFileSync(join(projectDir, ".pebble", "worktrees", "registry.json"), "utf-8")).toContain('"worktrees": []');
  });

  test("deleteSessionWithRuntimeCleanup removes a linked worktree before deleting the transcript", () => {
    const projectDir = createTempProject("pebble-runtime-delete-session-worktree-");
    initializeGitRepo(projectDir);
    writeFileSync(join(projectDir, "tracked.txt"), "base\n", "utf-8");
    commitAll(projectDir, "initial");

    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.createSession("cleanup-session");
    const manager = new WorktreeManager({ repoRoot: projectDir });
    const worktreePath = manager.createWorktree(session.id, `${session.id}-worktree`);
    sessionStore.updateMetadata(session.id, {
      worktree: {
        path: worktreePath,
        branch: `${session.id}-worktree`,
      },
    });

    const outcome = deleteSessionWithRuntimeCleanup(sessionStore, projectDir, session.id);

    expect(outcome.sessionDeleted).toBe(true);
    expect(outcome.worktreeRemoved).toBe(true);
    expect(outcome.worktreePath).toBe(worktreePath);
    expect(sessionStore.loadTranscript(session.id)).toBeNull();
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("executes a real end-to-end runtime tool flow through headless mode", async () => {
    const projectDir = createTempProject("pebble-runtime-tool-flow-", {
      settings: {
        provider: "tool-flow-provider",
        permissionMode: "auto-all",
      },
    });
    const notePath = join(projectDir, "note.txt");
    writeFileSync(notePath, "before\n", "utf-8");
    writeToolFlowExtension(projectDir, notePath);

    const { result: exitCode, stdout } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "update the note",
        cwd: projectDir,
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Flow finished.");
    expect(readFileSync(notePath, "utf-8")).toBe("after\n");

    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.getLatestSession();
    expect(session).not.toBeNull();
    const transcript = session ? sessionStore.loadTranscript(session.id) : null;
    const toolMessages = transcript?.messages.filter((message) => message.role === "tool") ?? [];
    expect(toolMessages.length).toBeGreaterThanOrEqual(2);
    expect(transcript?.messages.some((message) => message.role === "assistant" && message.content.includes("Flow finished."))).toBe(true);
  });

  test("refreshes stale session memory and injects it into resumed headless turns", async () => {
    const projectDir = createTempProject("pebble-runtime-memory-resume-", {
      settings: {
        provider: "memory-resume-provider",
      },
    });
    const sessionStore = createProjectSessionStore(projectDir);
    const session = sessionStore.createSession("memory-resume-session");

    sessionStore.appendMessage(session.id, {
      role: "user",
      content: "Old context from a previous turn",
      timestamp: new Date().toISOString(),
    });
    sessionStore.appendMessage(session.id, {
      role: "assistant",
      content: "Noted.",
      timestamp: new Date().toISOString(),
    });
    const baselineTranscript = sessionStore.loadTranscript(session.id);
    if (!baselineTranscript) {
      throw new Error("Expected baseline transcript to exist");
    }
    sessionStore.updateMemory(session.id, buildSessionMemory(baselineTranscript));
    sessionStore.appendMessage(session.id, {
      role: "user",
      content: "Stale follow-up context",
      timestamp: new Date().toISOString(),
    });

    writeMemoryResumeExtension(projectDir, "Stale follow-up context");

    const { result: exitCode, stdout } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "Resume with memory",
        cwd: projectDir,
        resume: session.id,
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("memory injected");

    const refreshed = sessionStore.loadTranscript(session.id);
    expect(refreshed?.memory?.summary).toContain("Stale follow-up context");
    expect(refreshed?.memory?.sourceMessageCount).toBe(4);
  });

  test("persists file-backed todos across separate headless runtime runs", async () => {
    const projectDir = createTempProject("pebble-runtime-todo-persistence-", {
      settings: {
        provider: "todo-persistence-provider",
      },
    });

    writeTodoPersistenceExtension(projectDir);

    const firstRun = await captureConsole(() =>
      run({
        headless: true,
        prompt: "add todo",
        cwd: projectDir,
      }),
    );
    expect(firstRun.result).toBe(0);

    const secondRun = await captureConsole(() =>
      run({
        headless: true,
        prompt: "list todos",
        cwd: projectDir,
      }),
    );

    expect(secondRun.result).toBe(0);
    expect(secondRun.stdout.join("\n")).toContain("1. [not-started] persisted todo");
  });

  test("loads .pebble/prompts/ files into the system prompt", async () => {
    const projectDir = createTempProject("pebble-runtime-prompts-", {
      settings: {
        provider: "prompt-check-ext",
      },
    });

    const extensionsDir = join(projectDir, "extensions");
    mkdirSync(extensionsDir, { recursive: true });

    writeFileSync(
      join(extensionsDir, "provider.ts"),
      `
class PromptCheckProvider {
  id = "prompt-check-ext";
  name = "Prompt Check Provider";
  model = "prompt-check-model";

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
    const prompt = options?.systemPrompt ?? "";
    const hasIdentity = prompt.includes("I am TestBot");
    const hasSafety = prompt.includes("always confirm destructive actions");
    return {
      text: hasIdentity && hasSafety ? "prompt files loaded" : "missing prompt files",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async *stream(_messages, options) {
    const prompt = options?.systemPrompt ?? "";
    const hasIdentity = prompt.includes("I am TestBot");
    const hasSafety = prompt.includes("always confirm destructive actions");
    const text = hasIdentity && hasSafety ? "prompt files loaded" : "missing prompt files";
    yield { textDelta: text, done: true, metadata: { stopReason: "end_turn" } };
  }

  isConfigured() {
    return true;
  }
}

export default {
  metadata: {
    id: "prompt-check-extension",
    name: "Prompt Check Extension",
    version: "1.0.0"
  },
  providers: [new PromptCheckProvider()],
};
      `.trim(),
      "utf-8",
    );

    const promptsDir = join(projectDir, ".pebble", "prompts");
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(join(promptsDir, "identity.md"), "# Identity\n\nI am TestBot, a test agent.", "utf-8");
    writeFileSync(join(promptsDir, "safety.md"), "# Safety\n\nYou must always confirm destructive actions.", "utf-8");

    const { result: exitCode, stdout, stderr } = await captureConsole(() =>
      run({
        headless: true,
        prompt: "hello",
        cwd: projectDir,
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain("prompt files loaded");
    expect(stderr.some((line) => line.includes("prompt file(s)"))).toBe(true);
  });
});

describe("interactive runtime permissions", () => {
  test("starts interactive mode without printing pre-TUI diagnostics", async () => {
    const projectDir = createTempProject("pebble-runtime-interactive-quiet-");
    let startReplCalls = 0;

    setStartReplForTesting(async (context) => {
      expect(context.cwd).toBe(projectDir);
      startReplCalls += 1;
      return 0;
    });

    try {
      const { result: exitCode, stderr } = await withProviderKeysUnset(() =>
        captureConsole(() =>
          run({
            cwd: projectDir,
          })
        )
      );

      expect(exitCode).toBe(0);
      expect(startReplCalls).toBe(1);
      expect(stderr).toEqual([]);
    } finally {
      setStartReplForTesting(null);
    }
  });

  test("interactive startup can prefer the newest linked worktree session when configured", async () => {
    const projectDir = createTempProject("pebble-runtime-interactive-worktree-startup-", {
      settings: {
        worktreeStartupMode: "resume-linked",
      },
    });
    const sessionStore = createProjectSessionStore(projectDir);
    const linkedSession = sessionStore.createSession("linked-session");
    const linkedWorktreePath = join(projectDir, ".pebble", "worktrees", linkedSession.id);
    mkdirSync(linkedWorktreePath, { recursive: true });
    sessionStore.updateMetadata(linkedSession.id, {
      worktree: {
        path: linkedWorktreePath,
        branch: `${linkedSession.id}-worktree`,
      },
    });
    sessionStore.createSession("newer-unlinked-session");

    let capturedSessionId: string | null | undefined;
    let capturedStartupMode: unknown;

    setStartReplForTesting(async (context) => {
      capturedSessionId = context.sessionId;
      capturedStartupMode = context.config.worktreeStartupMode;
      return 0;
    });

    try {
      const { result: exitCode } = await withProviderKeysUnset(() =>
        captureConsole(() =>
          run({ cwd: projectDir }),
        ),
      );

      expect(exitCode).toBe(0);
      expect(capturedSessionId).toBe(linkedSession.id);
      expect(capturedStartupMode).toBe("resume-linked");
    } finally {
      setStartReplForTesting(null);
    }
  });

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
      await waitFor(() => app.hasPendingPermission());
      expect(app.output()).toContain("Permission Required");

      app.resolvePendingPermission("deny");

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

  test("single Ctrl+C interrupts an in-flight interactive response", async () => {
    const projectDir = createTempProject("pebble-runtime-interactive-interrupt-", {
      settings: {
        provider: "interruptible-scripted",
        fullscreenRenderer: false,
      },
    });

    const sessionStore = createProjectSessionStore(projectDir);
    const provider = new InterruptibleInteractiveProvider();
    const app = mountInteractiveApp({
      cwd: projectDir,
      sessionStore,
      extensionProviders: [provider],
    });

    try {
      await submitPrompt(app.stdin, "start a long response");
      const sessionId = await waitForSessionId(sessionStore);

      await waitFor(() => provider.started);
      await sendKeys(app.stdin, "\u0003");

      await waitFor(() => provider.wasAborted);
      await waitFor(() => sessionStore.loadTranscript(sessionId)?.status === "interrupted");

      expect(sessionStore.loadTranscript(sessionId)?.status).toBe("interrupted");
      expect(app.output()).not.toContain("Provider error:");
    } finally {
      app.cleanup();
    }
  });

  test("captures a held spacebar voice transcript into the prompt", async () => {
    const projectDir = createTempProject("pebble-runtime-interactive-voice-", {
      settings: {
        voiceEnabled: true,
        fullscreenRenderer: false,
      },
    });

    const voiceRuntime: VoiceRuntime = {
      checkRecordingAvailability: async () => ({ available: true, reason: null }),
      checkVoiceDependencies: async () => ({ available: true, missing: [], installCommand: null }),
      requestMicrophonePermission: async () => true,
      startRecording: async (onData) => {
        onData(Buffer.from([0, 1, 2, 3]));
        return true;
      },
      stopRecording: () => {},
      isVoiceStreamAvailable: () => true,
      connectVoiceStream: async (callbacks) => {
        const connection = {
          send: (_chunk: Buffer) => {},
          finalize: async () => {
            callbacks.onTranscript("voice transcript", true);
            callbacks.onClose();
            return "post_closestream_endpoint" as const;
          },
          close: () => {},
          isConnected: () => true,
        };
        callbacks.onReady(connection);
        return connection;
      },
    };

    setVoiceRuntimeForTesting(voiceRuntime);

    const sessionStore = createProjectSessionStore(projectDir);
    const app = mountInteractiveApp({
      cwd: projectDir,
      sessionStore,
    });

    try {
      await sendKeys(app.stdin, "     ");
      await waitFor(() => app.output().includes("Recording…") || app.output().includes("Transcribing…"), 3000);
      for (let index = 0; index < 50; index += 1) {
        await flushInteractiveUi();
      }
      await sendKeys(app.stdin, "\r");

      const sessionId = await waitForSessionId(sessionStore);
      const transcript = sessionStore.loadTranscript(sessionId);
      expect(transcript?.messages.some((message) => message.role === "user" && message.content === "voice transcript")).toBe(true);
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

class InterruptibleInteractiveProvider implements Provider {
  readonly id = "interruptible-scripted";
  readonly name = "Interruptible Interactive Provider";
  readonly model = "interruptible-scripted-model";

  started = false;
  wasAborted = false;

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: false,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  async complete(): Promise<never> {
    throw new Error("InterruptibleInteractiveProvider only supports streaming");
  }

  async *stream(messages: Message[], options?: ProviderOptions): AsyncIterable<StreamChunk> {
    const lastMessage = messages.at(-1);
    if (lastMessage?.role !== "user") {
      return;
    }

    this.started = true;

    yield {
      textDelta: "Working on it…",
      done: false,
      metadata: {
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    };

    await waitForAbortSignal(options?.abortSignal, 2_000);

    if (options?.abortSignal?.aborted) {
      this.wasAborted = true;
      throw new Error("Aborted");
    }

    yield {
      textDelta: " still going",
      done: true,
      metadata: {
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    };
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
  isRaw = false;
  setRawMode(value: boolean): this {
    this.isRaw = value;
    return this;
  }
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
  hasPendingPermission: () => boolean;
  resolvePendingPermission: (choice: PermissionChoice) => void;
  cleanup: () => void;
} {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  const stderr = new TestOutput();
  let buffer = "";
  let latestPendingPermission: PendingPermission | null = null;
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

  const instance = render(React.createElement(App, {
    context: appContext,
    testController: {
      onPendingPermission: (pending: PendingPermission | null) => {
        latestPendingPermission = pending;
      },
    },
  }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    stdin,
    output: () => buffer,
    hasPendingPermission: () => latestPendingPermission !== null,
    resolvePendingPermission: (choice: PermissionChoice) => {
      latestPendingPermission?.resolve(choice);
    },
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
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

async function waitForAbortSignal(signal?: AbortSignal, timeoutMs = 1_000): Promise<void> {
  if (!signal || signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
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

function writeToolFlowExtension(projectDir: string, notePath: string): void {
  const extensionsDir = join(projectDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  writeFileSync(
    join(extensionsDir, "tool-flow.ts"),
    `
const NOTE_PATH = ${JSON.stringify(notePath)};

class ToolFlowProvider {
  id = "tool-flow-provider";
  name = "Tool Flow Provider";
  model = "tool-flow-model";

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
    const toolMessages = messages.filter((message) => message.role === "tool");

    if (toolMessages.length === 0) {
      return {
        text: "",
        toolCalls: [
          {
            id: "tool-flow-read",
            name: "WorkspaceRead",
            input: {
              action: "read_file",
              file_path: NOTE_PATH,
            },
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }

    if (toolMessages.length === 1) {
      return {
        text: "",
        toolCalls: [
          {
            id: "tool-flow-edit",
            name: "WorkspaceEdit",
            input: {
              action: "edit_file",
              file_path: NOTE_PATH,
              old_string: "before",
              new_string: "after",
            },
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }

    return {
      text: "Flow finished.",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async *stream() {
    throw new Error("ToolFlowProvider only supports complete()");
  }

  isConfigured() {
    return true;
  }
}

export default {
  metadata: {
    id: "tool-flow-extension",
    name: "Tool Flow Extension",
    version: "1.0.0"
  },
  providers: [new ToolFlowProvider()],
};
    `.trim(),
    "utf-8",
  );
}

function writeMemoryResumeExtension(projectDir: string, expectedSnippet: string): void {
  const extensionsDir = join(projectDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  writeFileSync(
    join(extensionsDir, "memory-resume.ts"),
    `
const EXPECTED_SNIPPET = ${JSON.stringify(expectedSnippet)};

class MemoryResumeProvider {
  id = "memory-resume-provider";
  name = "Memory Resume Provider";
  model = "memory-resume-model";

  getCapabilities() {
    return {
      streaming: false,
      toolUse: false,
      systemPrompt: true,
      multimodal: false,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      parallelToolCalls: false,
    };
  }

  async complete(messages) {
    const injectedMemory = messages.find((message) => message.role === "system" && message.content.includes("[Session memory]"));
    return {
      text: injectedMemory?.content.includes(EXPECTED_SNIPPET) ? "memory injected" : "memory missing",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async *stream() {
    throw new Error("MemoryResumeProvider only supports complete()");
  }

  isConfigured() {
    return true;
  }
}

export default {
  metadata: {
    id: "memory-resume-extension",
    name: "Memory Resume Extension",
    version: "1.0.0"
  },
  providers: [new MemoryResumeProvider()],
};
    `.trim(),
    "utf-8",
  );
}

function writeTodoPersistenceExtension(projectDir: string): void {
  const extensionsDir = join(projectDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  writeFileSync(
    join(extensionsDir, "todo-persistence.ts"),
    `
class TodoPersistenceProvider {
  id = "todo-persistence-provider";
  name = "Todo Persistence Provider";
  model = "todo-persistence-model";

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

    if (lastMessage?.role === "user") {
      if (lastMessage.content.toLowerCase().includes("add")) {
        return {
          text: "",
          toolCalls: [
            {
              id: "todo-add",
              name: "Memory",
              input: {
                action: "todo_add",
                title: "persisted todo",
              },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }

      return {
        text: "",
        toolCalls: [
          {
            id: "todo-list",
            name: "Memory",
            input: {
              action: "todo_list",
            },
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }

    return {
      text: lastMessage?.content ?? "done",
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async *stream() {
    throw new Error("TodoPersistenceProvider only supports complete()");
  }

  isConfigured() {
    return true;
  }
}

export default {
  metadata: {
    id: "todo-persistence-extension",
    name: "Todo Persistence Extension",
    version: "1.0.0"
  },
  providers: [new TodoPersistenceProvider()],
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