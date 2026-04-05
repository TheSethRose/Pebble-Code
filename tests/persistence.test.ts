import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/persistence/sessionStore";
import { compactTranscript, estimateTokens, TokenTracker } from "../src/persistence/compaction";
import { buildSessionMemory, isSessionMemoryStale } from "../src/persistence/memory";
import { compactSessionIfNeeded } from "../src/persistence/runtimeSessions";

describe("Session Store", () => {
  let store: SessionStore;
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), "pebble-test-sessions-"));
    store = new SessionStore(sessionsDir);
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  test("creates a new session", () => {
    const session = store.createSession("test-1");
    expect(session.id).toBe("test-1");
    expect(session.messages).toEqual([]);
    expect(session.status).toBe("active");
  });

  test("appends messages to a session", () => {
    store.createSession("test-2");
    store.appendMessage("test-2", {
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });

    const transcript = store.loadTranscript("test-2");
    expect(transcript).not.toBeNull();
    expect(transcript!.messages).toHaveLength(1);
    expect(transcript!.messages[0]!.content).toBe("Hello");
  });

  test("lists sessions sorted by update time", async () => {
    store.createSession("session-a");
    await new Promise((r) => setTimeout(r, 10));
    store.createSession("session-b");

    const sessions = store.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions[0]!.id).toBe("session-b");
  });

  test("forks a session", () => {
    store.createSession("original");
    store.appendMessage("original", {
      role: "user",
      content: "Test message",
      timestamp: new Date().toISOString(),
    });

    const forked = store.forkSession("original", "forked-1");
    expect(forked).not.toBeNull();
    expect(forked!.id).toBe("forked-1");
    expect(forked!.messages).toHaveLength(1);
    expect(forked!.status).toBe("active");
  });

  test("handles missing sessions gracefully", () => {
    const transcript = store.loadTranscript("nonexistent");
    expect(transcript).toBeNull();
  });

  test("updates session status", () => {
    store.createSession("status-test");
    store.updateStatus("status-test", "completed");

    const transcript = store.loadTranscript("status-test");
    expect(transcript!.status).toBe("completed");
  });

  test("persists generated session memory", () => {
    store.createSession("memory-persist-test");
    store.appendMessage("memory-persist-test", {
      role: "user",
      content: "Please remember that I am debugging the memory command",
      timestamp: new Date().toISOString(),
    });

    const transcript = store.loadTranscript("memory-persist-test");
    expect(transcript).not.toBeNull();

    const memory = buildSessionMemory(transcript!);
    store.updateMemory("memory-persist-test", memory);

    const saved = store.loadTranscript("memory-persist-test");
    expect(saved?.memory?.summary).toContain("Recent user focus");
    expect(saved?.memory?.sourceMessageCount).toBe(1);
  });

  test("clears persisted session memory", () => {
    store.createSession("memory-clear-test");
    store.appendMessage("memory-clear-test", {
      role: "assistant",
      content: "I summarized the previous work.",
      timestamp: new Date().toISOString(),
    });

    const transcript = store.loadTranscript("memory-clear-test");
    expect(transcript).not.toBeNull();

    store.updateMemory("memory-clear-test", buildSessionMemory(transcript!));
    const cleared = store.clearMemory("memory-clear-test");
    expect(cleared.memory).toBeUndefined();
    expect(store.loadTranscript("memory-clear-test")?.memory).toBeUndefined();
  });
});

describe("Session memory", () => {
  test("marks stored memory stale when transcript grows", () => {
    const transcript = {
      messages: [
        { role: "user" as const, content: "hello", timestamp: "2024-01-01" },
      ],
    };

    const memory = buildSessionMemory(transcript);
    expect(isSessionMemoryStale(memory, transcript)).toBe(false);

    const updatedTranscript = {
      messages: [
        ...transcript.messages,
        { role: "assistant" as const, content: "hi", timestamp: "2024-01-01" },
      ],
    };

    expect(isSessionMemoryStale(memory, updatedTranscript)).toBe(true);
  });
});

describe("Compaction", () => {
  test("does not compact short transcripts", () => {
    const messages = [
      { role: "user" as const, content: "Hello", timestamp: "2024-01-01" },
      { role: "assistant" as const, content: "Hi", timestamp: "2024-01-01" },
    ];

    const compacted = compactTranscript(messages);
    expect(compacted).toEqual(messages);
  });

  test("compacts long transcripts", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      content: `Message ${i}`,
      timestamp: "2024-01-01",
    }));

    const compacted = compactTranscript(messages);
    expect(compacted.length).toBeLessThan(messages.length);
    // Should have system messages + summary + recent messages
    expect(compacted.length).toBeLessThanOrEqual(25);
  });

  test("estimates tokens", () => {
    const messages = [
      { role: "user" as const, content: "Hello world", timestamp: "2024-01-01" },
    ];
    const tokens = estimateTokens(messages);
    expect(tokens).toBe(3); // "Hello world" = 11 chars / 4 ≈ 3
  });

  test("persists automatic compaction metadata when a session crosses the threshold", () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "pebble-test-sessions-"));
    const store = new SessionStore(sessionsDir);

    try {
      const session = store.createSession("compact-runtime-test");
      for (let index = 0; index < 30; index += 1) {
        store.appendMessage(session.id, {
          role: index % 2 === 0 ? "user" : "assistant",
          content: `Message ${index}`,
          timestamp: new Date().toISOString(),
        });
      }

      const compacted = compactSessionIfNeeded(store, session.id, 1);
      expect(compacted).not.toBeNull();
      expect(compacted!.messages.length).toBeLessThan(30);
      expect(compacted!.messages.some((message) => message.content.startsWith("[Compacted transcript summary]"))).toBe(true);
      expect(compacted!.metadata?.compactionCount).toBe(1);
      expect(compacted!.metadata?.compactThreshold).toBe(1);
      expect(compacted!.metadata?.lastCompactionArtifact).toMatchObject({
        kind: "compaction-artifact",
        compactedMessageCount: expect.any(Number),
        generatedAt: expect.any(String),
      });
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});

describe("Token Tracker", () => {
  test("tracks token usage", () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(100, 50);

    const budget = tracker.getBudget();
    expect(budget.inputTokens).toBe(100);
    expect(budget.outputTokens).toBe(50);
    expect(budget.totalTokens).toBe(150);
    expect(budget.estimatedCost).toBeGreaterThan(0);
  });

  test("accumulates across calls", () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(100, 50);
    tracker.recordUsage(200, 100);

    const budget = tracker.getBudget();
    expect(budget.inputTokens).toBe(300);
    expect(budget.outputTokens).toBe(150);
    expect(budget.totalTokens).toBe(450);
  });

  test("resets correctly", () => {
    const tracker = new TokenTracker();
    tracker.recordUsage(100, 50);
    tracker.reset();

    const budget = tracker.getBudget();
    expect(budget.totalTokens).toBe(0);
    expect(budget.estimatedCost).toBe(0);
  });
});
