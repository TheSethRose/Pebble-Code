import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../src/runtime/main";
import { createProjectSessionStore } from "../src/persistence/runtimeSessions";

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
});