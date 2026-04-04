import { test, expect, describe, beforeEach } from "bun:test";
import { SessionStore } from "../src/persistence/sessionStore";
import { compactTranscript, estimateTokens, TokenTracker } from "../src/persistence/compaction";

describe("Session Store", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(".pebble/test-sessions");
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
