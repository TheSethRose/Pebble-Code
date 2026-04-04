import React from "react";
import { describe, expect, test } from "bun:test";
import { render, useInput } from "ink";
import { PassThrough } from "node:stream";
import { DeleteConfirmDialog } from "../src/ui/components/DeleteConfirmDialog";
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
  columns = 60;
  rows = 12;
}

function InputConsumer() {
  useInput(() => {});
  return null;
}

function mountDialog(props: {
  selectedButton?: "delete" | "cancel";
  onDelete: () => void;
  onCancel: () => void;
}) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  const stderr = new TestOutput();
  let buffer = "";

  const append = (chunk: string | Buffer) => {
    buffer += chunk.toString();
  };

  stdout.on("data", append);
  stderr.on("data", append);

  const instance = render(
    <TerminalMouseProvider>
      <InputConsumer />
      <DeleteConfirmDialog
        title="Delete me maybe"
        selectedButton={props.selectedButton ?? "cancel"}
        mouseEnabled
        onDelete={props.onDelete}
        onCancel={props.onCancel}
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

  throw new Error("Timed out locating clickable dialog region");
}

async function clickUntilTriggeredReverse(
  stdin: TestInput,
  predicate: () => boolean,
  area: { left: number; right: number; top: number; bottom: number },
): Promise<void> {
  for (let y = area.top; y <= area.bottom; y += 1) {
    for (let x = area.right; x >= area.left; x -= 1) {
      await sendMousePress(stdin, x, y);
      if (predicate()) {
        return;
      }
    }
  }

  throw new Error("Timed out locating clickable dialog region");
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

describe("DeleteConfirmDialog mouse interaction", () => {
  test("renders the requested body and help copy", async () => {
    const dialog = mountDialog({
      onDelete: () => {},
      onCancel: () => {},
    });

    try {
      await waitFor(() => dialog.output().includes("Delete session?"));

      const output = dialog.output();
      expect(output).toContain("This will permanently delete the current session.");
      expect(output).toContain("\"Delete me maybe\"");
      expect(output).toContain("Click a button, or use ← → to switch.");
      expect(output).toContain("Enter confirms. Esc cancels.");
    } finally {
      dialog.cleanup();
    }
  });

  test("clicking Delete triggers the delete handler", async () => {
    let deleted = 0;
    let canceled = 0;
    const dialog = mountDialog({
      onDelete: () => {
        deleted += 1;
      },
      onCancel: () => {
        canceled += 1;
      },
    });

    try {
      await waitFor(() => dialog.output().includes("Delete session?"));
      await clickUntilTriggered(dialog.stdin, () => deleted === 1, {
        left: 10,
        right: 30,
        top: 7,
        bottom: 9,
      });

      expect(deleted).toBe(1);
      expect(canceled).toBe(0);
    } finally {
      dialog.cleanup();
    }
  });

  test("clicking Cancel triggers the cancel handler", async () => {
    let deleted = 0;
    let canceled = 0;
    const dialog = mountDialog({
      onDelete: () => {
        deleted += 1;
      },
      onCancel: () => {
        canceled += 1;
      },
    });

    try {
      await waitFor(() => dialog.output().includes("Delete session?"));
      await clickUntilTriggeredReverse(dialog.stdin, () => canceled === 1, {
        left: 29,
        right: 52,
        top: 7,
        bottom: 9,
      });

      expect(canceled).toBe(1);
      expect(deleted).toBe(0);
    } finally {
      dialog.cleanup();
    }
  });
});
