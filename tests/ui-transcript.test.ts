import React from "react";
import { describe, expect, test } from "bun:test";
import { TranscriptView, getTranscriptLineCount } from "../src/ui/components/TranscriptView";
import { MessageItem } from "../src/ui/components/MessageItem";
import { summariseArgs } from "../src/ui/components/PermissionPrompt";
import type { DisplayMessage } from "../src/ui/types";
import { transcriptToDisplayMessages } from "../src/persistence/runtimeSessions";

function createMessage(role: DisplayMessage["role"], content = "test", meta?: DisplayMessage["meta"]): DisplayMessage {
  return { role, content, meta };
}

describe("TranscriptView", () => {
  test("does not render a separate inline processing status row", () => {
    const element = TranscriptView({ messages: [createMessage("tool", "Bash", { toolName: "Bash" })] });
    const flat = flattenText(element);

    expect(flat).toContain("Bash");
    expect(flat).not.toContain("Running:");
  });

  test("shows an overflow notice alongside the visible message window", () => {
    const messages = Array.from({ length: 25 }, (_, index) =>
      createMessage(index % 2 === 0 ? "assistant" : "user", `message ${String(index + 1).padStart(2, "0")}`),
    );

    const element = TranscriptView({ messages });
    const flat = flattenText(element);

    expect(flat).toContain("earlier history above");
    expect(flat).toContain("message 25");
    expect(flat).not.toContain("message 01");
  });

  test("trims older tall messages when maxRows is constrained", () => {
    const messages = [
      createMessage("assistant", Array.from({ length: 12 }, (_, index) => `tool ${index + 1}`).join("\n")),
      createMessage("user", "show me the tree"),
      createMessage("assistant", "Here is the tree"),
    ];

    const element = TranscriptView({ messages, maxRows: 6, width: 60 });
    const flat = flattenText(element);

    expect(flat).not.toContain("tool 1");
    expect(flat).toContain("show me the tree");
    expect(flat).toContain("Here is the tree");
    expect(flat).toContain("earlier history above");
  });

  test("groups tool_call + tool_result into a single tool group", () => {
    const messages = [
      createMessage("user", "run ls"),
      createMessage("tool", "Bash", { toolName: "Bash" }),
      createMessage("tool_result", "Bash done", { toolName: "Bash" }),
      createMessage("assistant", "Here are the files."),
    ];

    expect(getTranscriptLineCount(messages, 80)).toBe(6);
  });

  test("collapses consecutive progress messages to the latest one", () => {
    const messages = [
      createMessage("progress", "Turn 1/50", { turnNumber: 1 }),
      createMessage("progress", "Turn 2/50", { turnNumber: 2 }),
      createMessage("progress", "Turn 3/50", { turnNumber: 3 }),
      createMessage("assistant", "Done"),
    ];

    const element = TranscriptView({ messages });
    const flat = flattenText(element);

    expect(getTranscriptLineCount(messages, 80)).toBe(3);
    expect(flat).toContain("Turn 3/50");
    expect(flat).not.toContain("Turn 1/50");
  });
});

describe("MessageItem", () => {
  test("renders user message with > marker", () => {
    const element = MessageItem({ message: createMessage("user", "hello") });
    const flat = flattenText(element);
    expect(flat).toContain(">");
    expect(flat).toContain("hello");
  });

  test("renders tool call as a component with toolName prop", () => {
    const element = MessageItem({
      message: createMessage("tool", "Bash", { toolName: "Bash", toolArgs: { command: "ls" } }),
    });
    // ToolCallMessage is a sub-component; verify the element was produced
    expect(element).toBeTruthy();
    expect(element.props).toBeDefined();
  });

  test("renders tool result with success marker", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "Bash done", {
        toolName: "Bash",
        toolOutput: "README.md\nsrc/",
        durationMs: 42,
      }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("✓");
    expect(flat).toContain("Bash done");
    expect(flat).toContain("README.md");
    expect(flat).toContain("42 ms");
  });

  test("renders error tool result with failure marker", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "Bash failed", { toolName: "Bash", isError: true }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("✗");
  });

  test("renders truncated tool output details", () => {
    const element = MessageItem({
      message: createMessage("tool_result", "FileRead done", {
        toolName: "FileRead",
        toolOutput: "line 1\nline 2",
        truncated: true,
      }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("[truncated]");
    expect(flat).toContain("line 1");
  });

  test("renders error messages with bold marker", () => {
    const element = MessageItem({
      message: createMessage("error", "Something went wrong", { isError: true }),
    });
    const flat = flattenText(element);
    expect(flat).toContain("Error");
    expect(flat).toContain("Something went wrong");
  });

  test("renders streaming message as a component", () => {
    const element = MessageItem({ message: createMessage("streaming", "partial response") });
    // StreamingMessage is a sub-component using hooks; verify element structure
    expect(element).toBeTruthy();
    expect(element.props).toBeDefined();
  });
});

describe("transcriptToDisplayMessages", () => {
  test("maps persisted tool transcript rows into completed tool result messages", () => {
    const display = transcriptToDisplayMessages({
      id: "session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "completed",
      messages: [
        {
          role: "tool",
          content: "README.md\nsrc/",
          timestamp: new Date().toISOString(),
          metadata: { success: true, durationMs: 19 },
          toolCall: {
            name: "Bash",
            args: { command: "ls" },
          },
        },
      ],
    });

    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({
      role: "tool_result",
      content: "Bash done",
      meta: {
        toolName: "Bash",
        toolArgs: { command: "ls" },
        toolOutput: "README.md\nsrc/",
        durationMs: 19,
      },
    });
  });

  test("marks denied or failed persisted tool rows as errors", () => {
    const display = transcriptToDisplayMessages({
      id: "session-2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "completed",
      messages: [
        {
          role: "tool",
          content: "Tool execution denied: Restricted mode",
          timestamp: new Date().toISOString(),
          metadata: { success: false, error: "Restricted mode" },
          toolCall: {
            name: "FileEdit",
            args: { file_path: "package.json" },
          },
        },
      ],
    });

    expect(display[0]?.meta?.isError).toBe(true);
    expect(display[0]?.content).toBe("FileEdit failed");
  });
});

describe("PermissionPrompt helpers", () => {
  test("summarises and truncates approval arguments for prompt rendering", () => {
    expect(summariseArgs({ command: "rm -rf /tmp/demo", force: true }, 24)).toContain("command:");
    expect(summariseArgs({ command: "rm -rf /tmp/demo", force: true }, 24).endsWith("…")).toBe(true);
    expect(summariseArgs({}, 24)).toBe("");
  });
});

/**
 * Recursively extract all text content from a React element tree.
 */
function flattenText(element: React.ReactElement): string {
  const parts: string[] = [];
  function walk(node: unknown) {
    if (typeof node === "string") {
      parts.push(node);
    } else if (typeof node === "number") {
      parts.push(String(node));
    } else if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (typeof props.children !== "undefined") {
        React.Children.forEach(props.children as React.ReactNode, walk);
      }
    }
  }
  walk(element);
  return parts.join(" ");
}