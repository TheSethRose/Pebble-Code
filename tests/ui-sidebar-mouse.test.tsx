import React from "react";
import { describe, expect, test } from "bun:test";
import { render, useInput } from "ink";
import { PassThrough } from "node:stream";
import { SessionSidebar, type SessionSummary } from "../src/ui/components/SessionSidebar";
import { TerminalMouseProvider } from "../src/ui/components/TerminalMouseProvider";

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
  columns = 30;
  rows = 10;
}

function InputConsumer() {
  useInput(() => {});
  return null;
}

function mountSidebar(
  props: {
    sessions: SessionSummary[];
    activeSessionId: string | null;
    onSelect: (sessionId: string | null, index: number) => void;
    onRequestDelete?: (session: SessionSummary, index: number) => void;
    selectedIndex?: number;
    isFocused?: boolean;
    width?: number;
  },
) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  const stderr = new TestOutput();
  let buffer = "";
  const originalStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;

  const append = (chunk: string | Buffer) => {
    buffer += chunk.toString();
  };

  stdout.on("data", append);
  stderr.on("data", append);
  process.stdout.write = ((..._args: Parameters<typeof process.stdout.write>) => true) as typeof process.stdout.write;

  const instance = render(
    <TerminalMouseProvider>
      <InputConsumer />
      <SessionSidebar
        sessions={props.sessions}
        activeSessionId={props.activeSessionId}
        onSelect={props.onSelect}
        onRequestDelete={props.onRequestDelete}
        selectedIndex={props.selectedIndex ?? 0}
        isFocused={props.isFocused ?? false}
        mouseEnabled
        width={props.width ?? 30}
      />
    </TerminalMouseProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

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
      process.stdout.write = originalStdoutWrite;
    },
  };
}

async function sendMousePress(stdin: TestInput, x: number, y: number): Promise<void> {
  stdin.write(`\u001B[<0;${x + 1};${y + 1}M`);
  await flushInteractiveUi();
}

async function clickUntilTriggered(
  stdin: TestInput,
  predicate: () => boolean,
  area: { left: number; right: number; top: number; bottom: number },
): Promise<void> {
  for (let y = area.top; y <= area.bottom; y += 1) {
    for (let x = area.left; x <= area.right; x += 1) {
      await sendMousePress(stdin, x, y);
      if (predicate()) {
        return;
      }
    }
  }

  throw new Error("Timed out locating clickable sidebar region");
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

const sessions: SessionSummary[] = [
  {
    id: "session-a",
    title: "First thread",
    updatedAt: new Date().toISOString(),
    status: "completed",
    messageCount: 2,
  },
  {
    id: "session-b",
    title: "Second thread",
    updatedAt: new Date().toISOString(),
    status: "completed",
    messageCount: 4,
  },
];

describe("SessionSidebar mouse interaction", () => {
  test("clicking a saved chat row emits that chat id and index", async () => {
    const selections: Array<{ sessionId: string | null; index: number }> = [];
    const sidebar = mountSidebar({
      sessions,
      activeSessionId: null,
      onSelect: (sessionId, index) => {
        selections.push({ sessionId, index });
      },
    });

    try {
      await waitFor(() => sidebar.output().includes("First thread") && sidebar.output().includes("Second thread"));

      await sendMousePress(sidebar.stdin, 2, 3);

      await waitFor(() => selections.length === 1);

      expect(selections).toEqual([{ sessionId: "session-a", index: 1 }]);
    } finally {
      sidebar.cleanup();
    }
  });

  test("clicking the new chat row emits a null session selection", async () => {
    const selections: Array<{ sessionId: string | null; index: number }> = [];
    const sidebar = mountSidebar({
      sessions,
      activeSessionId: "session-b",
      onSelect: (sessionId, index) => {
        selections.push({ sessionId, index });
      },
    });

    try {
      await waitFor(() => sidebar.output().includes("◈ New Chat"));

      await sendMousePress(sidebar.stdin, 2, 2);

      await waitFor(() => selections.length === 1);

      expect(selections).toEqual([{ sessionId: null, index: 0 }]);
    } finally {
      sidebar.cleanup();
    }
  });

  test("clicking the x delete target requests deletion without also selecting the chat", async () => {
    const selections: Array<{ sessionId: string | null; index: number }> = [];
    const deletions: Array<{ sessionId: string; index: number }> = [];
    const sidebar = mountSidebar({
      sessions,
      activeSessionId: null,
      onSelect: (sessionId, index) => {
        selections.push({ sessionId, index });
      },
      onRequestDelete: (session, index) => {
        deletions.push({ sessionId: session.id, index });
      },
    });

    try {
      await waitFor(() => sidebar.output().includes(" x "));

      await clickUntilTriggered(sidebar.stdin, () => deletions.length === 1, {
        left: 27,
        right: 29,
        top: 3,
        bottom: 4,
      });

      expect(deletions.length).toBeGreaterThan(0);
      expect(deletions[0]).toEqual({ sessionId: "session-a", index: 1 });
      expect(selections).toEqual([]);
    } finally {
      sidebar.cleanup();
    }
  });
});
